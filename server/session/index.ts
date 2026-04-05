import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import type { IncomingMessage } from "http";

import { SttStream } from "../../voice/stt_stream";
import { VadDetector } from "../../voice/vad_detector";
import { InterruptController } from "../../voice/interrupt_controller";
import { AvatarController } from "../../avatar/avatar_controller";
import { createLogger } from "../../infra/logger";
import { isDbReady } from "../../infra/app_state";
import { getLatencyTracer, removeLatencyTracer } from "../../infra/latency_tracer";
import { createSession as createDbSession, endSession } from "../../storage/repositories/session_repository";
import { RemSessionContext } from "../../brains/rem_session_context";
import { runPipeline } from "../pipeline";
import { send, getWsRateLimiter } from "../gateway";

const logger = createLogger("session");
const AUDIO_BIN_MAGIC_V1 = Buffer.from([0x52, 0x41]); // "RA" (legacy)
const AUDIO_BIN_MAGIC_V2 = Buffer.from([0x52, 0x41, 0x55, 0x44]); // "RAUD"
const AUDIO_BIN_VERSION = 1;
const AUDIO_BIN_HEADER_BYTES_V1 = 8;
const AUDIO_BIN_HEADER_BYTES_V2 = 16;
const AUDIO_BIN_CODEC_PCM16_MONO = 1;

/** Ring buffer duration (ms) kept before speech_start — inject into STT so minSpeech ramp-up does not clip sentence beginnings. */
function preRollMaxBytes(sampleRate: number): number {
  const raw = process.env.VAD_PRE_ROLL_MS;
  const ms = raw !== undefined && raw !== "" ? Number(raw) : 480;
  const dur = Number.isFinite(ms) && ms > 0 ? ms : 480;
  return Math.floor((sampleRate * 2 * dur) / 1000);
}

/**
 * After speech_end, wait this long before running STT. If speech_start fires again
 * (user continued after a short pause), the same PCM buffer is extended — one sentence
 * is not split into multiple stt_final messages. Set to 0 to disable (immediate STT).
 */
function utteranceGapMs(): number {
  const raw = process.env.VAD_UTTERANCE_GAP_MS;
  if (raw === undefined || raw === "") return 180;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 180;
  return n;
}

function parseNonNegativeMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function sttPreviewIntervalMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_INTERVAL_MS, 650);
}

function sttPreviewDebounceMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_DEBOUNCE_MS, 180);
}

function sttPreviewMinSpeechMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_MIN_SPEECH_MS, 550);
}

function sttPreviewWindowMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_WINDOW_MS, 4200);
}

/** Minimum utterance duration to run STT after VAD speech_end. */
function minSpeechMs(): number {
  return parseNonNegativeMs(process.env.VAD_MIN_UTTERANCE_MS, 220);
}

/**
 * After speech_end, delay before STT. Longer spoken segments get a longer merge window
 * (mid-sentence pause); short phrases use a shorter delay (snappier end).
 * Set VAD_UTTERANCE_GAP_ADAPTIVE=0 for a fixed VAD_UTTERANCE_GAP_MS (legacy behavior).
 */
function effectiveUtteranceGapMs(speechDurationMs: number): number {
  const base = utteranceGapMs();
  if (base <= 0) return 0;

  if (process.env.VAD_UTTERANCE_GAP_ADAPTIVE === "0") {
    return base;
  }

  const minG = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_MIN_MS, 120);
  const maxG = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_MAX_MS, 320);
  const lo = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_ADAPTIVE_LO_MS, 400);
  const hi = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_ADAPTIVE_HI_MS, 4400);
  if (maxG <= minG) return base;

  const t = Math.min(1, Math.max(0, (speechDurationMs - lo) / Math.max(1, hi - lo)));
  return Math.round(minG + t * (maxG - minG));
}

/** 用户多久没发消息后触发 Rem 主动搭话（ms）；未设置或 0 表示关闭 */
function silenceNudgeMs(): number {
  const raw = process.env.REM_SILENCE_NUDGE_MS;
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function endsWithSentencePunctuation(text: string): boolean {
  return /[。！？.!?]\s*$/.test(text);
}

export class ConnectionSession {
  readonly connId: string;
  readonly brain: RemSessionContext;
  readonly ws: WebSocket;
  readonly stt: SttStream;
  readonly vad: VadDetector;
  readonly interrupt: InterruptController;
  readonly avatar: AvatarController;

  sessionId: string | null = null;
  pipelineChain: Promise<void> = Promise.resolve();
  duplexActive: boolean = false;
  speechBuffer: Buffer[] = [];
  private speechBufferBytes: number = 0;

  /** Last ~VAD_PRE_ROLL_MS of PCM before speech_start (same chunks client sends). */
  private preRollChunks: Buffer[] = [];
  private preRollBytes = 0;
  private duplexSampleRate = 16000;
  /** After injecting pre-roll, skip one push — current chunk is already in pre-roll. */
  private suppressNextSpeechChunk = false;

  /** Deferred STT after speech_end so mid-sentence pauses can merge into one utterance. */
  private pendingUtteranceTimer: ReturnType<typeof setTimeout> | null = null;

  /** 用户无消息后触发陪伴搭话（需 REM_SILENCE_NUDGE_MS>0） */
  private silenceNudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewInFlight = false;
  private lastPreviewAt = 0;
  private lastPreviewText = "";
  private lastPartialEmitAt = 0;
  private lastPartialContent = "";
  private generationSeq = 0;
  private activeGenerationId: number | null = null;
  private traceSeq = 0;
  private pendingVoiceTraceId: string | null = null;
  private activeTraceId: string | null = null;

  constructor(ws: WebSocket) {
    this.connId = randomUUID();
    this.brain = new RemSessionContext(this.connId);
    this.ws = ws;
    this.stt = new SttStream();
    this.vad = new VadDetector();
    this.interrupt = new InterruptController();
    this.avatar = new AvatarController();

    this.setupVadEvents();
    this.setupMessageHandlers();
    this.setupCloseHandlers();
  }

  async initializeAsync(): Promise<void> {
    logger.info("[Rem] 新客户端已连接", { connId: this.connId });

    if (isDbReady()) {
      try {
        const sess = await createDbSession("dev");
        this.sessionId = sess.id;
        logger.info("[Storage] Session created", { sessionId: this.sessionId });
      } catch (err) {
        logger.warn("[Storage] Failed to create session", { error: err });
      }
    }
  }

  private pushSpeechChunk(chunk: Buffer): void {
    this.speechBuffer.push(chunk);
    this.speechBufferBytes += chunk.length;
  }

  private clearSpeechBuffer(): void {
    this.speechBuffer = [];
    this.speechBufferBytes = 0;
  }

  private clearPendingUtteranceTimer(): void {
    if (this.pendingUtteranceTimer) {
      clearTimeout(this.pendingUtteranceTimer);
      this.pendingUtteranceTimer = null;
    }
  }

  private clearSilenceNudgeTimer(): void {
    if (this.silenceNudgeTimer) {
      clearTimeout(this.silenceNudgeTimer);
      this.silenceNudgeTimer = null;
    }
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }

  private resetPreviewState(): void {
    this.clearPreviewTimer();
    this.stt.cancelPreview();
    this.previewInFlight = false;
    this.lastPreviewAt = 0;
    this.lastPreviewText = "";
    this.lastPartialEmitAt = 0;
    this.lastPartialContent = "";
  }

  private emitSttPartial(content: string): void {
    if (!content) return;
    const now = Date.now();
    const sameContent = content === this.lastPartialContent;
    if (sameContent && now - this.lastPartialEmitAt < 120) return;
    const traceId = this.pendingVoiceTraceId ?? this.activeTraceId;
    if (traceId) {
      getLatencyTracer(this.connId).mark("stt_partial", traceId);
    }
    send(this.ws, { type: "stt_partial", content });
    this.lastPartialEmitAt = now;
    this.lastPartialContent = content;
  }

  private nextGenerationId(): number {
    this.generationSeq += 1;
    this.activeGenerationId = this.generationSeq;
    return this.generationSeq;
  }

  private sendInterrupt(generationId: number | null = this.activeGenerationId): void {
    if (typeof generationId === "number") {
      send(this.ws, { type: "interrupt", generationId });
      return;
    }
    send(this.ws, { type: "interrupt" });
  }

  private createTraceId(source: "voice" | "text" | "silence_nudge", generationId?: number): string {
    this.traceSeq += 1;
    const g = typeof generationId === "number" ? `-g${generationId}` : "";
    return `${source}${g}-${Date.now()}-${this.traceSeq}`;
  }

  private startTrace(traceId: string, source: "voice" | "text" | "silence_nudge", generationId?: number): void {
    getLatencyTracer(this.connId).startTrace(traceId, { source, generationId });
  }

  private ensureVoiceTrace(startMarkVad: boolean): string {
    if (!this.pendingVoiceTraceId) {
      this.pendingVoiceTraceId = this.createTraceId("voice");
      this.startTrace(this.pendingVoiceTraceId, "voice");
    }
    if (startMarkVad) {
      getLatencyTracer(this.connId).mark("vad_speech_start", this.pendingVoiceTraceId);
    }
    return this.pendingVoiceTraceId;
  }

  private takeVoiceTrace(): string {
    if (!this.pendingVoiceTraceId) {
      this.pendingVoiceTraceId = this.createTraceId("voice");
      this.startTrace(this.pendingVoiceTraceId, "voice");
    }
    const traceId = this.pendingVoiceTraceId;
    this.pendingVoiceTraceId = null;
    return traceId;
  }

  private bindActiveGeneration(generationId: number, traceId: string, source: "voice" | "text" | "silence_nudge"): void {
    this.activeTraceId = traceId;
    this.startTrace(traceId, source, generationId);
  }

  private resolveUtteranceGapMs(speechDurationMs: number): number {
    const base = effectiveUtteranceGapMs(speechDurationMs);
    if (base <= 0) return 0;

    const preview = this.lastPreviewText.trim();
    if (!preview) return base;

    const holdMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_HOLD_MS, 140);
    const releaseMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_RELEASE_MS, 60);
    const minMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_MIN_MS, 80);
    const maxMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_MAX_MS, 520);
    const sentenceClosed = endsWithSentencePunctuation(preview);

    if (sentenceClosed) {
      return Math.max(minMs, base - releaseMs);
    }
    if (preview.length >= 8) {
      return Math.min(maxMs, base + holdMs);
    }
    return base;
  }

  private scheduleSttPreview(speechMs: number): void {
    const fallback = `录音中… ${(speechMs / 1000).toFixed(1)}s`;
    if (!this.stt.canPreviewPcm()) {
      this.emitSttPartial(fallback);
      return;
    }
    if (speechMs < sttPreviewMinSpeechMs()) {
      this.emitSttPartial(fallback);
      return;
    }
    if (this.previewInFlight || this.previewTimer) return;

    const now = Date.now();
    const interval = sttPreviewIntervalMs();
    const debounce = sttPreviewDebounceMs();
    const remain = Math.max(0, interval - (now - this.lastPreviewAt));
    const delay = Math.max(debounce, remain);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      void this.runSttPreview();
    }, delay);
  }

  private async runSttPreview(): Promise<void> {
    if (!this.duplexActive || !this.vad.speaking || this.previewInFlight) return;
    this.previewInFlight = true;
    this.lastPreviewAt = Date.now();
    try {
      const pcm = this.speechBufferBytes > 0 ? Buffer.concat(this.speechBuffer) : Buffer.alloc(0);
      const preview = await this.stt.previewPcmBuffer(pcm, this.duplexSampleRate, sttPreviewWindowMs());
      if (!this.duplexActive || !this.vad.speaking) return;

      const text = typeof preview === "string" ? preview.trim() : "";
      if (text) {
        if (text !== this.lastPreviewText) {
          this.lastPreviewText = text;
          this.emitSttPartial(text);
        }
        return;
      }

      const durMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
      this.emitSttPartial(`录音中… ${(durMs / 1000).toFixed(1)}s`);
    } catch (err) {
      logger.debug("[STT preview]", {
        connId: this.connId,
        error: (err as Error).message,
      });
      const durMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
      this.emitSttPartial(`录音中… ${(durMs / 1000).toFixed(1)}s`);
    } finally {
      this.previewInFlight = false;
    }
  }

  /** 用户每次发文字或语音被识别后调用，重新计时沉默搭话 */
  private touchUserActivity(): void {
    this.clearSilenceNudgeTimer();
    const ms = silenceNudgeMs();
    if (ms <= 0) return;
    this.silenceNudgeTimer = setTimeout(() => this.fireSilenceNudge(), ms);
  }

  /**
   * 沉默超时：串进 pipelineChain，与用户消息互斥；结束后继续计时下一轮。
   */
  private fireSilenceNudge(): void {
    this.silenceNudgeTimer = null;
    const ms = silenceNudgeMs();
    if (ms <= 0) return;

    if (this.interrupt.active) {
      this.silenceNudgeTimer = setTimeout(() => this.fireSilenceNudge(), 8000);
      return;
    }

    const nudgeText = this.brain.slowBrain.buildSilenceNudgeUserMessage();
    if (!nudgeText) {
      this.silenceNudgeTimer = setTimeout(() => this.fireSilenceNudge(), ms);
      return;
    }

    logger.info("[陪伴] 沉默搭话", { connId: this.connId });
    this.pipelineChain = this.pipelineChain
      .then(async () => {
        const generationId = this.nextGenerationId();
        const traceId = this.createTraceId("silence_nudge", generationId);
        this.bindActiveGeneration(generationId, traceId, "silence_nudge");
        await runPipeline(
          this.ws,
          nudgeText,
          this.interrupt,
          this.avatar,
          this.sessionId,
          this.brain,
          generationId,
          traceId,
          { silenceNudge: true },
        );
      })
      .catch((err) => {
        logger.warn("[陪伴] 沉默搭话失败", {
          error: (err as Error).message,
          connId: this.connId,
        });
      })
      .finally(() => {
        if (silenceNudgeMs() > 0) {
          this.silenceNudgeTimer = setTimeout(() => this.fireSilenceNudge(), ms);
        }
      });
  }

  /** Feed accumulated speechBuffer into STT and run pipeline (buffer cleared after feed). */
  private enqueueSttFromSpeechBuffer(): void {
    this.stt.cancelPreview();
    for (const chunk of this.speechBuffer) {
      this.stt.feedPcm(chunk);
    }
    this.clearSpeechBuffer();

    this.pipelineChain = this.pipelineChain
      .then(async () => {
        const traceId = this.takeVoiceTrace();
        try {
          const text = await this.stt.endPcm();
          if (!text) return;
          const generationId = this.nextGenerationId();
          this.bindActiveGeneration(generationId, traceId, "voice");
          getLatencyTracer(this.connId).mark("stt_final", traceId);
          send(this.ws, { type: "stt_final", content: text });
          logger.info(`[用户·语音] ${text}`, { connId: this.connId });
          this.touchUserActivity();
          await runPipeline(
            this.ws,
            text,
            this.interrupt,
            this.avatar,
            this.sessionId,
            this.brain,
            generationId,
            traceId,
          );
        } catch (err) {
          logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
          send(this.ws, { type: "error", content: "语音识别失败：" + (err as Error).message });
        }
      })
      .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
  }

  private setupVadEvents(): void {
    this.vad.on("speech_start", () => {
      logger.info("[VAD] speech_start", { connId: this.connId });

      // Always tell the client to stop TTS playback — the server pipeline may
      // already be idle while audio is still playing from the queue.
      this.sendInterrupt();
      if (this.interrupt.active) {
        this.interrupt.interrupt();
        logger.info("[VAD] → interrupted pipeline", { connId: this.connId });
      }

      this.resetPreviewState();
      this.stt.cancelPcm();

      const merging = this.pendingUtteranceTimer !== null;
      this.clearPendingUtteranceTimer();
      this.ensureVoiceTrace(!merging);

      if (merging) {
        // We are extending the same utterance after a short pause. Re-appending
        // the whole pre-roll duplicates already buffered speech and can explode
        // the final STT window length when VAD flaps multiple times in one
        // sentence. In merge mode we keep the existing speech buffer as-is and
        // resume from the current chunk onward.
      } else {
        this.clearSpeechBuffer();
        for (const c of this.preRollChunks) {
          this.pushSpeechChunk(Buffer.from(c));
        }
      }
      this.preRollChunks = [];
      this.preRollBytes = 0;
      this.suppressNextSpeechChunk = !merging;

      send(this.ws, { type: "vad_start" });
    });

    this.vad.on("speech_end", () => {
      logger.info("[VAD] speech_end", { connId: this.connId });
      if (this.pendingVoiceTraceId) {
        getLatencyTracer(this.connId).mark("vad_speech_end", this.pendingVoiceTraceId);
      }
      send(this.ws, { type: "vad_end" });
      this.clearPreviewTimer();

      const MIN_SPEECH_MS = minSpeechMs();
      const speechDurationMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
      const gap = this.resolveUtteranceGapMs(speechDurationMs);
      logger.debug("[VAD] utterance_gap", {
        connId: this.connId,
        speechMs: Math.round(speechDurationMs),
        gapMs: gap,
        adaptive: process.env.VAD_UTTERANCE_GAP_ADAPTIVE !== "0",
        preview: this.lastPreviewText || undefined,
      });

      if (gap <= 0) {
        if (speechDurationMs < MIN_SPEECH_MS) {
          logger.info(`[VAD] speech too short (${speechDurationMs.toFixed(0)}ms < ${MIN_SPEECH_MS}ms), discarding`, { connId: this.connId });
          this.clearSpeechBuffer();
          this.resetPreviewState();
          this.pendingVoiceTraceId = null;
          this.stt.cancelPcm();
          return;
        }
        this.clearPreviewTimer();
        this.previewInFlight = false;
        this.enqueueSttFromSpeechBuffer();
        return;
      }

      this.clearPendingUtteranceTimer();
      this.pendingUtteranceTimer = setTimeout(() => {
        this.pendingUtteranceTimer = null;
        const durMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
        if (durMs < MIN_SPEECH_MS) {
          logger.info(`[VAD] utterance still too short after gap (${durMs.toFixed(0)}ms), discarding`, {
            connId: this.connId,
          });
          this.clearSpeechBuffer();
          this.resetPreviewState();
          this.pendingVoiceTraceId = null;
          this.stt.cancelPcm();
          return;
        }
        this.clearPreviewTimer();
        this.previewInFlight = false;
        this.enqueueSttFromSpeechBuffer();
      }, gap);
    });
  }

  private setupMessageHandlers(): void {
    this.ws.on("message", (raw) => {
      const binary = this.parseBinaryAudioFrame(raw);
      if (binary) {
        this.handleAudioPcm(binary.pcm, binary.sampleRate);
        return;
      }

      let data: any;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        data = { type: "chat", content: raw.toString() };
      }

      const bypassRateLimit =
        data.type === "audio_stream" ||
        data.type === "audio_chunk" ||
        data.type === "playback_start";
      if (!bypassRateLimit) {
        const limiter = getWsRateLimiter();
        if (limiter && !limiter.check(this.connId)) {
          send(this.ws, { type: "error", content: "消息频率过高，请稍后再试" });
          return;
        }
      }

      switch (data.type) {
        case "duplex_start":
          this.handleDuplexStart(data);
          break;
        case "duplex_stop":
          this.handleDuplexStop();
          break;
        case "audio_stream":
          this.handleAudioStream(data);
          break;
        case "audio_chunk":
          this.handleAudioChunk(data);
          break;
        case "audio_end":
          this.handleAudioEnd();
          break;
        case "playback_start":
          this.handlePlaybackStart();
          break;
        default:
          this.handleChat(data);
          break;
      }
    });
  }

  private handleDuplexStart(data: any): void {
    this.duplexActive = true;
    const rate = Number(data.sampleRate) || 16000;
    this.duplexSampleRate = rate;
    this.stt.setSampleRate(rate);
    this.vad.reset();
    this.stt.reset();
    this.clearSpeechBuffer();
    this.preRollChunks = [];
    this.preRollBytes = 0;
    this.suppressNextSpeechChunk = false;
    this.clearPendingUtteranceTimer();
    this.resetPreviewState();
    this.pendingVoiceTraceId = null;
    logger.info(`[Duplex] 已启动`, { connId: this.connId, sampleRate: rate });
  }

  private handleDuplexStop(): void {
    this.duplexActive = false;
    this.vad.reset();
    this.clearPendingUtteranceTimer();
    this.resetPreviewState();
    this.preRollChunks = [];
    this.preRollBytes = 0;
    this.suppressNextSpeechChunk = false;

    if (this.speechBuffer.length > 0) {
      this.stt.cancelPreview();
      for (const chunk of this.speechBuffer) this.stt.feedPcm(chunk);
      this.clearSpeechBuffer();

      this.pipelineChain = this.pipelineChain
        .then(async () => {
          const traceId = this.takeVoiceTrace();
          try {
            const text = await this.stt.endPcm();
            if (!text) return;
            const generationId = this.nextGenerationId();
            this.bindActiveGeneration(generationId, traceId, "voice");
            getLatencyTracer(this.connId).mark("stt_final", traceId);
            send(this.ws, { type: "stt_final", content: text });
            logger.info(`[用户·语音] ${text}`, { connId: this.connId });
            this.touchUserActivity();
            await runPipeline(
              this.ws,
              text,
              this.interrupt,
              this.avatar,
              this.sessionId,
              this.brain,
              generationId,
              traceId,
            );
          } catch (err) {
            logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
          }
        })
        .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
    } else {
      this.pendingVoiceTraceId = null;
    }

    logger.info("[Duplex] 已停止", { connId: this.connId });
  }

  private appendPreRoll(pcm: Buffer): void {
    this.preRollChunks.push(pcm);
    this.preRollBytes += pcm.length;
    const maxBytes = preRollMaxBytes(this.duplexSampleRate);
    while (this.preRollBytes > maxBytes && this.preRollChunks.length > 0) {
      const first = this.preRollChunks.shift()!;
      this.preRollBytes -= first.length;
    }
  }

  /**
   * Binary audio frame formats (little-endian):
   *
   * V2 (current)
   * [0..3]   magic "RAUD"
   * [4]      version (1)
   * [5]      codec (1 = pcm16le mono)
   * [6..7]   reserved
   * [8..11]  sampleRate uint32
   * [12..15] payload byteLength uint32
   * [16..N]  PCM16LE mono payload
   *
   * V1 (legacy compatibility)
   * [0..1]   magic "RA"
   * [2]      version (1)
   * [3]      flags (reserved)
   * [4..7]   sampleRate uint32
   * [8..N]   PCM16LE mono payload
   */
  private parseBinaryAudioFrame(raw: unknown): { sampleRate: number; pcm: Buffer } | null {
    const asBuffer = (value: unknown): Buffer | null => {
      if (Buffer.isBuffer(value)) return value;
      if (value instanceof ArrayBuffer) return Buffer.from(value);
      if (Array.isArray(value) && value.every((v) => Buffer.isBuffer(v))) {
        return Buffer.concat(value as Buffer[]);
      }
      return null;
    };

    const buf = asBuffer(raw);
    if (!buf) return null;

    if (buf.length >= AUDIO_BIN_HEADER_BYTES_V2 + 2 && buf.subarray(0, 4).equals(AUDIO_BIN_MAGIC_V2)) {
      if (buf[4] !== AUDIO_BIN_VERSION) return null;
      if (buf[5] !== AUDIO_BIN_CODEC_PCM16_MONO) return null;

      const sampleRate = buf.readUInt32LE(8);
      const payloadBytes = buf.readUInt32LE(12);
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
      if (payloadBytes <= 0 || buf.length < AUDIO_BIN_HEADER_BYTES_V2 + payloadBytes) return null;

      const pcm = buf.subarray(AUDIO_BIN_HEADER_BYTES_V2, AUDIO_BIN_HEADER_BYTES_V2 + payloadBytes);
      return { sampleRate, pcm: Buffer.from(pcm) };
    }

    if (buf.length >= AUDIO_BIN_HEADER_BYTES_V1 + 2 && buf.subarray(0, 2).equals(AUDIO_BIN_MAGIC_V1)) {
      if (buf[2] !== AUDIO_BIN_VERSION) return null;

      const sampleRate = buf.readUInt32LE(4);
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;

      const pcm = buf.subarray(AUDIO_BIN_HEADER_BYTES_V1);
      if (pcm.length === 0) return null;
      return { sampleRate, pcm: Buffer.from(pcm) };
    }

    return null;
  }

  private handleAudioPcm(pcm: Buffer, rate: number): void {
    if (!this.duplexActive) return;
    const sampleRate = rate > 0 ? rate : this.duplexSampleRate;
    this.duplexSampleRate = sampleRate;
    this.stt.setSampleRate(sampleRate);

    this.appendPreRoll(pcm);
    this.vad.feed(pcm);

    if (this.vad.speaking) {
      if (this.suppressNextSpeechChunk) {
        this.suppressNextSpeechChunk = false;
      } else {
        this.pushSpeechChunk(pcm);
      }

      const durMs = (this.speechBufferBytes / 2 / sampleRate) * 1000;
      this.scheduleSttPreview(durMs);
    }
  }

  private handleAudioStream(data: any): void {
    const pcm = Buffer.from(data.audio, "base64");
    const rate = Number(data.sampleRate) || this.duplexSampleRate;
    this.handleAudioPcm(pcm, rate);
  }

  private handleAudioChunk(data: any): void {
    this.stt.feed(Buffer.from(data.audio, "base64"));
  }

  private handleAudioEnd(): void {
    this.pipelineChain = this.pipelineChain
      .then(async () => {
        const traceId = this.createTraceId("voice");
        this.startTrace(traceId, "voice");
        try {
          const text = await this.stt.end();
          if (!text) return;
          const generationId = this.nextGenerationId();
          this.bindActiveGeneration(generationId, traceId, "voice");
          getLatencyTracer(this.connId).mark("stt_final", traceId);
          send(this.ws, { type: "stt_final", content: text });
          logger.info(`[用户·语音] ${text}`, { connId: this.connId });
          this.touchUserActivity();
          await runPipeline(
            this.ws,
            text,
            this.interrupt,
            this.avatar,
            this.sessionId,
            this.brain,
            generationId,
            traceId,
          );
        } catch (err) {
          logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
          send(this.ws, { type: "error", content: "语音识别失败：" + (err as Error).message });
        }
      })
      .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
  }

  private handlePlaybackStart(): void {
    if (this.activeTraceId) {
      getLatencyTracer(this.connId).mark("playback_start", this.activeTraceId);
    }
  }

  private handleChat(data: any): void {
    const content = data.content ?? "";
    if (!content?.trim()) {
      send(this.ws, { type: "error", content: "消息内容为空" });
      return;
    }
    logger.info(`[用户] ${content}`, { connId: this.connId });
    this.touchUserActivity();

    // Always notify client to stop any queued/playing audio immediately.
    this.sendInterrupt();
    if (this.interrupt.active) {
      this.interrupt.interrupt();
    }

    const generationId = this.nextGenerationId();
    const traceId = this.createTraceId("text", generationId);
    this.bindActiveGeneration(generationId, traceId, "text");

    this.pipelineChain = this.pipelineChain
      .then(() =>
        runPipeline(
          this.ws,
          content,
          this.interrupt,
          this.avatar,
          this.sessionId,
          this.brain,
          generationId,
          traceId,
        ),
      )
      .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
  }

  private setupCloseHandlers(): void {
    this.ws.on("close", () => {
      this.duplexActive = false;
      this.vad.reset();
      this.clearPendingUtteranceTimer();
      this.clearSilenceNudgeTimer();
      this.resetPreviewState();
      this.interrupt.interrupt();
      logger.info("[Rem] 客户端已断开", { connId: this.connId });

      if (isDbReady() && this.sessionId) {
        void endSession(this.sessionId).catch((err) => {
          logger.warn("[Storage] Failed to end session", { error: err, sessionId: this.sessionId });
        });
      }

      removeLatencyTracer(this.connId);
    });

    this.ws.on("error", (err) => logger.error("[WebSocket 错误]", { error: err, connId: this.connId }));
  }
}

export function createSession(ws: WebSocket, _req: IncomingMessage): ConnectionSession {
  const session = new ConnectionSession(ws);
  session.initializeAsync().catch((err) => {
    logger.error("[Session] initializeAsync failed", { error: err, connId: session.connId });
  });
  return session;
}

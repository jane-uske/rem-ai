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
  if (raw === undefined || raw === "") return 420;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 420;
  return n;
}

/** 用户多久没发消息后触发 Rem 主动搭话（ms）；未设置或 0 表示关闭 */
function silenceNudgeMs(): number {
  const raw = process.env.REM_SILENCE_NUDGE_MS;
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
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
        await runPipeline(
          this.ws,
          nudgeText,
          this.interrupt,
          this.avatar,
          this.sessionId,
          this.brain,
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
    for (const chunk of this.speechBuffer) {
      this.stt.feedPcm(chunk);
    }
    this.clearSpeechBuffer();

    this.pipelineChain = this.pipelineChain
      .then(async () => {
        try {
          const text = await this.stt.endPcm();
          if (!text) return;
          getLatencyTracer(this.connId).mark("stt_final");
          send(this.ws, { type: "stt_final", content: text });
          logger.info(`[用户·语音] ${text}`, { connId: this.connId });
          this.touchUserActivity();
          await runPipeline(this.ws, text, this.interrupt, this.avatar, this.sessionId, this.brain);
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
      const tracer = getLatencyTracer(this.connId);
      tracer.reset();
      tracer.mark("vad_speech_start");

      // Always tell the client to stop TTS playback — the server pipeline may
      // already be idle while audio is still playing from the queue.
      send(this.ws, { type: "interrupt" });
      if (this.interrupt.active) {
        this.interrupt.interrupt();
        logger.info("[VAD] → interrupted pipeline", { connId: this.connId });
      }

      this.stt.cancelPcm();

      const merging = this.pendingUtteranceTimer !== null;
      this.clearPendingUtteranceTimer();

      if (merging) {
        for (const c of this.preRollChunks) {
          this.pushSpeechChunk(Buffer.from(c));
        }
      } else {
        this.clearSpeechBuffer();
        for (const c of this.preRollChunks) {
          this.pushSpeechChunk(Buffer.from(c));
        }
      }
      this.preRollChunks = [];
      this.preRollBytes = 0;
      this.suppressNextSpeechChunk = true;

      send(this.ws, { type: "vad_start" });
    });

    this.vad.on("speech_end", () => {
      logger.info("[VAD] speech_end", { connId: this.connId });
      getLatencyTracer(this.connId).mark("vad_speech_end");
      send(this.ws, { type: "vad_end" });

      const MIN_SPEECH_MS = 420;
      const speechDurationMs = (this.speechBufferBytes / 2 / 16000) * 1000;
      const gap = utteranceGapMs();

      if (gap <= 0) {
        if (speechDurationMs < MIN_SPEECH_MS) {
          logger.info(`[VAD] speech too short (${speechDurationMs.toFixed(0)}ms < ${MIN_SPEECH_MS}ms), discarding`, { connId: this.connId });
          this.clearSpeechBuffer();
          this.stt.cancelPcm();
          return;
        }
        this.enqueueSttFromSpeechBuffer();
        return;
      }

      this.clearPendingUtteranceTimer();
      this.pendingUtteranceTimer = setTimeout(() => {
        this.pendingUtteranceTimer = null;
        const durMs = (this.speechBufferBytes / 2 / 16000) * 1000;
        if (durMs < MIN_SPEECH_MS) {
          logger.info(`[VAD] utterance still too short after gap (${durMs.toFixed(0)}ms), discarding`, {
            connId: this.connId,
          });
          this.clearSpeechBuffer();
          this.stt.cancelPcm();
          return;
        }
        this.enqueueSttFromSpeechBuffer();
      }, gap);
    });
  }

  private setupMessageHandlers(): void {
    this.ws.on("message", (raw) => {
      let data: any;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        data = { type: "chat", content: raw.toString() };
      }

      const isAudioMsg = data.type === "audio_stream" || data.type === "audio_chunk";
      if (!isAudioMsg) {
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
    logger.info(`[Duplex] 已启动`, { connId: this.connId, sampleRate: rate });
  }

  private handleDuplexStop(): void {
    this.duplexActive = false;
    this.vad.reset();
    this.clearPendingUtteranceTimer();
    this.preRollChunks = [];
    this.preRollBytes = 0;
    this.suppressNextSpeechChunk = false;

    if (this.speechBuffer.length > 0) {
      for (const chunk of this.speechBuffer) this.stt.feedPcm(chunk);
      this.clearSpeechBuffer();

      this.pipelineChain = this.pipelineChain
        .then(async () => {
          try {
            const text = await this.stt.endPcm();
            if (!text) return;
            getLatencyTracer(this.connId).mark("stt_final");
            send(this.ws, { type: "stt_final", content: text });
            logger.info(`[用户·语音] ${text}`, { connId: this.connId });
            this.touchUserActivity();
            await runPipeline(this.ws, text, this.interrupt, this.avatar, this.sessionId, this.brain);
          } catch (err) {
            logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
          }
        })
        .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
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

  private handleAudioStream(data: any): void {
    if (!this.duplexActive) return;
    const pcm = Buffer.from(data.audio, "base64");
    const rate = Number(data.sampleRate) || this.duplexSampleRate;

    this.appendPreRoll(pcm);
    this.vad.feed(pcm);

    if (this.vad.speaking) {
      if (this.suppressNextSpeechChunk) {
        this.suppressNextSpeechChunk = false;
      } else {
        this.pushSpeechChunk(pcm);
      }

      const durMs = (this.speechBufferBytes / 2 / rate) * 1000;
      getLatencyTracer(this.connId).mark("stt_partial");
      send(this.ws, { type: "stt_partial", content: `录音中… ${(durMs / 1000).toFixed(1)}s` });
    }
  }

  private handleAudioChunk(data: any): void {
    this.stt.feed(Buffer.from(data.audio, "base64"));
  }

  private handleAudioEnd(): void {
    this.pipelineChain = this.pipelineChain
      .then(async () => {
        try {
          const text = await this.stt.end();
          if (!text) return;
          getLatencyTracer(this.connId).mark("stt_final");
          send(this.ws, { type: "stt_final", content: text });
          logger.info(`[用户·语音] ${text}`, { connId: this.connId });
          this.touchUserActivity();
          await runPipeline(this.ws, text, this.interrupt, this.avatar, this.sessionId, this.brain);
        } catch (err) {
          logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
          send(this.ws, { type: "error", content: "语音识别失败：" + (err as Error).message });
        }
      })
      .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
  }

  private handleChat(data: any): void {
    const content = data.content ?? "";
    if (!content?.trim()) {
      send(this.ws, { type: "error", content: "消息内容为空" });
      return;
    }
    logger.info(`[用户] ${content}`, { connId: this.connId });
    this.touchUserActivity();

    if (this.interrupt.active) {
      this.interrupt.interrupt();
      send(this.ws, { type: "interrupt" });
    }

    const tracer = getLatencyTracer(this.connId);
    tracer.reset();

    this.pipelineChain = this.pipelineChain
      .then(() => runPipeline(this.ws, content, this.interrupt, this.avatar, this.sessionId, this.brain))
      .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
  }

  private setupCloseHandlers(): void {
    this.ws.on("close", () => {
      this.duplexActive = false;
      this.vad.reset();
      this.clearPendingUtteranceTimer();
      this.clearSilenceNudgeTimer();
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

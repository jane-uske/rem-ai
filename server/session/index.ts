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
import { runPipeline } from "../pipeline";
import { send, getWsRateLimiter } from "../gateway";

const logger = createLogger("session");

export class ConnectionSession {
  readonly connId: string;
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

  constructor(ws: WebSocket) {
    this.connId = randomUUID();
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

  private setupVadEvents(): void {
    this.vad.on("speech_start", () => {
      logger.info("[VAD] speech_start", { connId: this.connId });
      const tracer = getLatencyTracer(this.connId);
      tracer.reset();
      tracer.mark("vad_speech_start");

      if (this.interrupt.active) {
        this.interrupt.interrupt();
        send(this.ws, { type: "interrupt" });
        logger.info("[VAD] → interrupted pipeline", { connId: this.connId });
      }

      this.stt.cancelPcm();
      this.clearSpeechBuffer();
      send(this.ws, { type: "vad_start" });
    });

    this.vad.on("speech_end", () => {
      logger.info("[VAD] speech_end", { connId: this.connId });
      getLatencyTracer(this.connId).mark("vad_speech_end");
      send(this.ws, { type: "vad_end" });

      const MIN_SPEECH_MS = 400;
      const speechDurationMs = (this.speechBufferBytes / 2 / 16000) * 1000;
      if (speechDurationMs < MIN_SPEECH_MS) {
        logger.info(`[VAD] speech too short (${speechDurationMs.toFixed(0)}ms < ${MIN_SPEECH_MS}ms), discarding`, { connId: this.connId });
        this.clearSpeechBuffer();
        this.stt.cancelPcm();
        return;
      }

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
            await runPipeline(this.ws, text, this.interrupt, this.avatar, this.sessionId, this.connId);
          } catch (err) {
            logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
            send(this.ws, { type: "error", content: "语音识别失败：" + (err as Error).message });
          }
        })
        .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
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
    this.stt.setSampleRate(rate);
    this.vad.reset();
    this.stt.reset();
    this.clearSpeechBuffer();
    logger.info(`[Duplex] 已启动`, { connId: this.connId, sampleRate: rate });
  }

  private handleDuplexStop(): void {
    this.duplexActive = false;
    this.vad.reset();

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
            await runPipeline(this.ws, text, this.interrupt, this.avatar, this.sessionId, this.connId);
          } catch (err) {
            logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
          }
        })
        .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
    }

    logger.info("[Duplex] 已停止", { connId: this.connId });
  }

  private handleAudioStream(data: any): void {
    if (!this.duplexActive) return;
    const pcm = Buffer.from(data.audio, "base64");

    this.vad.feed(pcm);

    if (this.vad.speaking) {
      this.pushSpeechChunk(pcm);

      const durMs = (this.speechBufferBytes / 2 / (Number(data.sampleRate) || 16000)) * 1000;
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
          await runPipeline(this.ws, text, this.interrupt, this.avatar, this.sessionId, this.connId);
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

    if (this.interrupt.active) {
      this.interrupt.interrupt();
      send(this.ws, { type: "interrupt" });
    }

    const tracer = getLatencyTracer(this.connId);
    tracer.reset();

    this.pipelineChain = this.pipelineChain
      .then(() => runPipeline(this.ws, content, this.interrupt, this.avatar, this.sessionId, this.connId))
      .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
  }

  private setupCloseHandlers(): void {
    this.ws.on("close", () => {
      this.duplexActive = false;
      this.vad.reset();
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

import "dotenv/config";
import http from "http";
import path from "path";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";

import { chatStream } from "../agents/conversation_agent";
import { decayEmotion, updateEmotion } from "../emotion/emotion_engine";
import { SttStream } from "../voice/stt_stream";
import { synthesize, isTtsEnabled } from "../voice/tts_stream";
import { SentenceChunker } from "../utils/sentence_chunker";
import { VadDetector } from "../voice/vad_detector";
import { InterruptController } from "../voice/interrupt_controller";

const PORT = 3000;

interface ServerMessage {
  type: string;
  content?: string;
  emotion?: string;
  audio?: string;
}

const dev = process.env.NODE_ENV !== "production";
const webDir = path.join(process.cwd(), "web");
const nextApp = next({ dev, dir: webDir });
const handle = nextApp.getRequestHandler();

/* ──────────────────────────────────────────────────────
 *  Next.js + WebSocket (single port)
 * ────────────────────────────────────────────────────── */

async function bootstrap() {
  await nextApp.prepare();

  const server = http.createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url || "", true);
      void handle(req, res, parsedUrl);
    } catch (err) {
      console.error("[HTTP]", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "");
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
    // Other upgrade requests (Next.js HMR etc.) are left for Next.js internals
  });

  /* ──────────────────────────────────────────────────────
   *  Per-connection session
   * ────────────────────────────────────────────────────── */

  wss.on("connection", (ws) => {
    console.log("[Rem] 新客户端已连接");

    /* ── Shared state ── */
    const stt = new SttStream();
    const vad = new VadDetector();
    const interrupt = new InterruptController();

    let pipelineChain = Promise.resolve();
    let duplexActive = false;
    let speechBuffer: Buffer[] = [];

    /* ── VAD events ── */

    vad.on("speech_start", () => {
      console.log("[VAD] speech_start");

      // If AI is generating / speaking → interrupt
      if (interrupt.active) {
        interrupt.interrupt();
        send(ws, { type: "interrupt" });
        console.log("[VAD] → interrupted pipeline");
      }

      // Reset STT buffer and start accumulating
      stt.cancelPcm();
      speechBuffer = [];
      send(ws, { type: "vad_start" });
    });

    vad.on("speech_end", () => {
      console.log("[VAD] speech_end");
      send(ws, { type: "vad_end" });

      // Feed accumulated speech to STT and run pipeline
      for (const chunk of speechBuffer) {
        stt.feedPcm(chunk);
      }
      speechBuffer = [];

      pipelineChain = pipelineChain
        .then(async () => {
          try {
            const text = await stt.endPcm();
            if (!text) return;
            send(ws, { type: "stt_final", content: text });
            console.log(`[用户·语音] ${text}`);
            await runPipeline(ws, text, interrupt);
          } catch (err) {
            console.warn("[STT]", (err as Error).message);
            send(ws, { type: "error", content: "语音识别失败：" + (err as Error).message });
          }
        })
        .catch((err) => console.error("[pipeline]", err));
    });

    /* ── Message handler ── */

    ws.on("message", (raw) => {
      let data: any;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        data = { type: "chat", content: raw.toString() };
      }

      switch (data.type) {
        /* ── Full-duplex voice protocol ── */

        case "duplex_start": {
          duplexActive = true;
          const rate = Number(data.sampleRate) || 16000;
          stt.setSampleRate(rate);
          vad.reset();
          stt.reset();
          speechBuffer = [];
          console.log(`[Duplex] 已启动 (sampleRate=${rate})`);
          break;
        }

        case "duplex_stop": {
          duplexActive = false;
          vad.reset();

          // If user was mid-speech, transcribe what we have
          if (speechBuffer.length > 0) {
            for (const chunk of speechBuffer) stt.feedPcm(chunk);
            speechBuffer = [];

            pipelineChain = pipelineChain
              .then(async () => {
                try {
                  const text = await stt.endPcm();
                  if (!text) return;
                  send(ws, { type: "stt_final", content: text });
                  console.log(`[用户·语音] ${text}`);
                  await runPipeline(ws, text, interrupt);
                } catch (err) {
                  console.warn("[STT]", (err as Error).message);
                }
              })
              .catch((err) => console.error("[pipeline]", err));
          }

          console.log("[Duplex] 已停止");
          break;
        }

        case "audio_stream": {
          if (!duplexActive) break;
          const pcm = Buffer.from(data.audio, "base64");

          // Always feed VAD
          vad.feed(pcm);

          // Accumulate PCM while user is speaking
          if (vad.speaking) {
            speechBuffer.push(pcm);

            // Send partial indicator
            const totalBytes = speechBuffer.reduce((s, b) => s + b.length, 0);
            const durMs = (totalBytes / 2 / (Number(data.sampleRate) || 16000)) * 1000;
            send(ws, { type: "stt_partial", content: `录音中… ${(durMs / 1000).toFixed(1)}s` });
          }
          break;
        }

        /* ── Legacy voice protocol (half-duplex) ── */

        case "audio_chunk":
          stt.feed(Buffer.from(data.audio, "base64"));
          break;

        case "audio_end":
          pipelineChain = pipelineChain
            .then(async () => {
              try {
                const text = await stt.end();
                if (!text) return;
                send(ws, { type: "stt_final", content: text });
                console.log(`[用户·语音] ${text}`);
                await runPipeline(ws, text, interrupt);
              } catch (err) {
                console.warn("[STT]", (err as Error).message);
                send(ws, { type: "error", content: "语音识别失败：" + (err as Error).message });
              }
            })
            .catch((err) => console.error("[pipeline]", err));
          break;

        /* ── Text chat ── */

        default: {
          const content = data.content ?? raw.toString();
          if (!content?.trim()) {
            send(ws, { type: "error", content: "消息内容为空" });
            return;
          }
          console.log(`[用户] ${content}`);

          // Text input also interrupts any running pipeline
          if (interrupt.active) {
            interrupt.interrupt();
            send(ws, { type: "interrupt" });
          }

          pipelineChain = pipelineChain
            .then(() => runPipeline(ws, content, interrupt))
            .catch((err) => console.error("[pipeline]", err));
          break;
        }
      }
    });

    ws.on("close", () => {
      duplexActive = false;
      vad.reset();
      interrupt.interrupt();
      console.log("[Rem] 客户端已断开");
    });
    ws.on("error", (err) => console.error("[WebSocket 错误]", err));
  });

  /* ──────────────────────────────────────────────────────
   *  Core pipeline:  emotion → LLM stream → sentence chunk → TTS
   *
   *  The pipeline respects the AbortSignal from InterruptController:
   *    - LLM streaming breaks on abort
   *    - TTS skips remaining sentences on abort
   *    - Partial reply is still saved to history
   * ────────────────────────────────────────────────────── */

  async function runPipeline(
    ws: WebSocket,
    text: string,
    ic: InterruptController,
  ) {
    const signal = ic.begin();

    try {
      const replyEmotion = updateEmotion(text);
      send(ws, { type: "emotion", emotion: replyEmotion });

      const chunker = new SentenceChunker();
      let full = "";
      let ttsChain = Promise.resolve();

      for await (const token of chatStream(text, signal)) {
        if (signal.aborted) break;

        full += token;
        send(ws, { type: "chat_chunk", content: token });

        for (const sentence of chunker.push(token)) {
          const s = sentence;
          ttsChain = ttsChain.then(() => {
            if (signal.aborted) return;
            ic.markSpeaking();
            return ttsSend(ws, s, signal);
          });
        }
      }

      if (!signal.aborted) {
        const last = chunker.flush();
        if (last) {
          ttsChain = ttsChain.then(() => {
            if (signal.aborted) return;
            return ttsSend(ws, last, signal);
          });
        }
      } else {
        chunker.reset();
      }

      // Always send chat_end so the client can finalise the message bubble
      send(ws, {
        type: "chat_end",
        emotion: replyEmotion,
        content: signal.aborted ? "[interrupted]" : undefined,
      });

      if (full) {
        console.log(`[Rem] ${full}${signal.aborted ? " (interrupted)" : ""} (emotion: ${replyEmotion})`);
      }
      decayEmotion();

      ttsChain.catch((err) => {
        if ((err as Error).name !== "AbortError") {
          console.warn("[TTS bg]", (err as Error).message);
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[错误]", err);
        send(ws, { type: "error", content: "AI 回复生成失败" });
      }
    } finally {
      ic.finish();
    }
  }

  async function ttsSend(ws: WebSocket, sentence: string, signal?: AbortSignal) {
    if (!isTtsEnabled()) return;
    if (signal?.aborted) return;
    try {
      const audio = await synthesize(sentence, signal);
      if (signal?.aborted) return;
      send(ws, { type: "voice", audio: audio.toString("base64") });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.warn("[TTS]", (err as Error).message);
      }
    }
  }

  function send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  server.listen(PORT, () => {
    console.log(`[Rem AI] 服务已启动 — http://localhost:${PORT}`);
    if (dev) {
      console.log(`[Rem AI] Next.js 开发模式 (目录: ${webDir})`);
    }
  });
}

bootstrap().catch((err) => {
  console.error("[Rem AI] 启动失败", err);
  process.exit(1);
});

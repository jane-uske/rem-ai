import { WebSocket } from "ws";

import { chatStream } from "../../agents/conversation_agent";
import type { RemSessionContext } from "../../brains/rem_session_context";
import { decayEmotion } from "../../emotion/decay_emotion";
import { updateEmotion } from "../../emotion/emotion_engine";
import { synthesize, isTtsEnabled } from "../../voice/tts_stream";
import { SentenceChunker } from "../../utils/sentence_chunker";
import { InterruptController } from "../../voice/interrupt_controller";
import { AvatarController } from "../../avatar/avatar_controller";
import { createLogger } from "../../infra/logger";
import { isDbReady } from "../../infra/app_state";
import { getLatencyTracer } from "../../infra/latency_tracer";
import { saveMessage } from "../../storage/repositories/message_repository";
import { send } from "../gateway";

const logger = createLogger("pipeline");

export type RunPipelineOptions = {
  /** 用户久未说话时的主动搭话：不写入 user 消息、不跑慢脑/记忆 */
  silenceNudge?: boolean;
};

export async function runPipeline(
  ws: WebSocket,
  text: string,
  ic: InterruptController,
  avatar: AvatarController,
  sessionId: string | null,
  ctx: RemSessionContext,
  options?: RunPipelineOptions,
): Promise<void> {
  const connId = ctx.connId;
  const signal = ic.begin();
  const latencyTracer = getLatencyTracer(connId);

  try {
    const replyEmotion = options?.silenceNudge
      ? ctx.emotion.getEmotion()
      : updateEmotion(text, ctx.emotion);
    send(ws, { type: "emotion", emotion: replyEmotion });

    const avatarFrames = avatar.setEmotion(replyEmotion as any);
    for (const frame of avatarFrames) {
      send(ws, { type: "avatar_frame", frame });
    }

    if (isDbReady() && sessionId && !options?.silenceNudge) {
      try {
        await saveMessage(sessionId, "user", text);
      } catch (err) {
        logger.warn("[Storage] Failed to save user message", { error: err, sessionId });
      }
    }

    const thinkingFiller =
      !options?.silenceNudge &&
      (process.env.rem_thinking_filler === "1" ||
        process.env.REM_THINKING_FILLER === "1");
    if (thinkingFiller && isTtsEnabled() && !signal.aborted) {
      void synthesize("嗯", signal, replyEmotion as any)
        .then((buf) => {
          if (!signal.aborted) {
            send(ws, { type: "voice", audio: buf.toString("base64") });
          }
        })
        .catch(() => {});
    }

    // ── Producer-consumer TTS: synthesize sentences as they stream in ──

    const sentenceQueue: string[] = [];
    let sentenceIdx = 0;
    let producerDone = false;
    let waitResolve: (() => void) | null = null;

    function pushSentence(s: string) {
      sentenceQueue.push(s);
      if (waitResolve) {
        const r = waitResolve;
        waitResolve = null;
        r();
      }
    }

    function endProducer() {
      producerDone = true;
      if (waitResolve) {
        const r = waitResolve;
        waitResolve = null;
        r();
      }
    }

    const onAbort = () => endProducer();
    signal.addEventListener("abort", onAbort, { once: true });

    let firstAudioSent = false;
    let ttsError: Error | null = null;

    const ttsTask = (async () => {
      while (true) {
        if (signal.aborted) break;

        if (sentenceIdx < sentenceQueue.length) {
          const sentence = sentenceQueue[sentenceIdx++];
          if (signal.aborted) break;

          if (sentenceIdx === 1) latencyTracer.mark("tts_start");

          try {
            ic.markSpeaking();
            await ttsSend(ws, sentence, signal, replyEmotion, latencyTracer, !firstAudioSent);
            if (!firstAudioSent) firstAudioSent = true;
          } catch (err) {
            if ((err as Error).name === "AbortError") break;
            logger.warn("[TTS]", { error: (err as Error).message, connId });
            ttsError = err as Error;
          }
        } else if (producerDone) {
          break;
        } else {
          await new Promise<void>((r) => { waitResolve = r; });
        }
      }
    })();

    // ── LLM streaming (producer) ──

    const chunker = new SentenceChunker();
    chunker.setEager(true);
    let full = "";
    let firstTokenReceived = false;
    let firstSentenceSent = false;

    latencyTracer.mark("llm_request_start");

    for await (const token of chatStream(
      ctx,
      text,
      replyEmotion,
      signal,
      options?.silenceNudge ? { systemTriggered: true } : undefined,
    )) {
      if (signal.aborted) break;

      if (!firstTokenReceived) {
        firstTokenReceived = true;
        latencyTracer.mark("llm_first_token");
      }

      full += token;
      send(ws, { type: "chat_chunk", content: token });

      for (const sentence of chunker.push(token)) {
        pushSentence(sentence);
        if (!firstSentenceSent) {
          firstSentenceSent = true;
          chunker.setEager(false);
        }
      }
    }

    latencyTracer.mark("llm_end");

    if (!signal.aborted) {
      const last = chunker.flush();
      if (last) pushSentence(last);
    } else {
      chunker.reset();
    }

    endProducer();
    signal.removeEventListener("abort", onAbort);

    // ── Post-LLM steps (run while TTS processes in parallel) ──

    send(ws, {
      type: "chat_end",
      emotion: replyEmotion,
      content: signal.aborted ? "[interrupted]" : undefined,
    });

    if (isDbReady() && sessionId && full) {
      try {
        await saveMessage(sessionId, "assistant", full);
      } catch (err) {
        logger.warn("[Storage] Failed to save assistant message", { error: err, sessionId });
      }
    }

    if (full && !signal.aborted) {
      const actionFrames = avatar.processReply(full);
      for (const frame of actionFrames) {
        send(ws, { type: "avatar_frame", frame });
      }
    }

    if (full) {
      logger.info(`[Rem] ${full}${signal.aborted ? " (interrupted)" : ""}`, {
        emotion: replyEmotion,
        connId,
      });
    }

    // Wait for TTS consumer to finish
    await ttsTask;

    decayEmotion(ctx.emotion);

    latencyTracer.mark("tts_end");
    latencyTracer.log();
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      logger.error("[错误]", { error: err, connId });
      send(ws, { type: "error", content: "AI 回复生成失败" });
    }
  } finally {
    ic.finish();
  }
}

async function ttsSend(
  ws: WebSocket,
  sentence: string,
  signal?: AbortSignal,
  emotion?: string,
  latencyTracer?: ReturnType<typeof getLatencyTracer>,
  isFirstSentence: boolean = false,
): Promise<void> {
  if (!isTtsEnabled()) return;
  if (signal?.aborted) return;
  try {
    const audio = await synthesize(sentence, signal, emotion as any);
    if (signal?.aborted) return;
    if (isFirstSentence && latencyTracer) {
      latencyTracer.mark("tts_first_audio");
    }
    send(ws, { type: "voice", audio: audio.toString("base64") });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      logger.warn("[TTS]", { error: (err as Error).message });
    }
  }
}

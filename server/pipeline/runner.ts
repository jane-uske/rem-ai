import { WebSocket } from "ws";

import { chatStream } from "../../agents/conversation_agent";
import { decayEmotion, updateEmotion } from "../../emotion/emotion_engine";
import { synthesize, isTtsEnabled } from "../../voice/tts_stream";
import { SentenceChunker } from "../../utils/sentence_chunker";
import { InterruptController } from "../../voice/interrupt_controller";
import { AvatarController } from "../../avatar/avatar_controller";
import { createLogger } from "../../infra/logger";
import { saveMessage } from "../../storage/repositories/message_repository";
import { send } from "../gateway";

const logger = createLogger("pipeline");

// Global state for optional storage
let dbReady = false;

export function setDbReady(ready: boolean): void {
  dbReady = ready;
}

export async function runPipeline(
  ws: WebSocket,
  text: string,
  ic: InterruptController,
  avatar: AvatarController,
  sessionId: string | null,
  connId: string,
): Promise<void> {
  const signal = ic.begin();

  try {
    const replyEmotion = updateEmotion(text);
    send(ws, { type: "emotion", emotion: replyEmotion });

    // Avatar emotion transition
    const avatarFrames = avatar.setEmotion(replyEmotion as any);
    for (const frame of avatarFrames) {
      send(ws, { type: "avatar_frame", frame });
    }

    // Persist user message if DB available
    if (dbReady && sessionId) {
      try {
        await saveMessage(sessionId, "user", text);
      } catch (err) {
        logger.warn("[Storage] Failed to save user message", { error: err, sessionId });
      }
    }

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
          return ttsSend(ws, s, signal, replyEmotion);
        });
      }
    }

    if (!signal.aborted) {
      const last = chunker.flush();
      if (last) {
        ttsChain = ttsChain.then(() => {
          if (signal.aborted) return;
          return ttsSend(ws, last, signal, replyEmotion);
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

    // Persist assistant message if DB available
    if (dbReady && sessionId && full) {
      try {
        await saveMessage(sessionId, "assistant", full);
      } catch (err) {
        logger.warn("[Storage] Failed to save assistant message", { error: err, sessionId });
      }
    }

    // Avatar actions from reply
    if (full) {
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
    decayEmotion();

    ttsChain.catch((err) => {
      if ((err as Error).name !== "AbortError") {
        logger.warn("[TTS bg]", { error: (err as Error).message, connId });
      }
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      logger.error("[错误]", { error: err, connId });
      send(ws, { type: "error", content: "AI 回复生成失败" });
    }
  } finally {
    ic.finish();
  }
}

async function ttsSend(ws: WebSocket, sentence: string, signal?: AbortSignal, emotion?: string): Promise<void> {
  if (!isTtsEnabled()) return;
  if (signal?.aborted) return;
  try {
    const audio = await synthesize(sentence, signal, emotion as any);
    if (signal?.aborted) return;
    send(ws, { type: "voice", audio: audio.toString("base64") });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      logger.warn("[TTS]", { error: (err as Error).message });
    }
  }
}

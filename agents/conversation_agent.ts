import { routeMessage } from "../brains/brain_router";
import type { Emotion } from "../emotion/emotion_state";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Streams AI reply tokens for the given user message.
 * Internally delegates to Brain Router which drives Fast Brain (streaming)
 * and Slow Brain (background analysis) in parallel.
 */
export async function* chatStream(
  message: string,
  emotion: Emotion,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  yield* routeMessage(message, emotion, signal);
}

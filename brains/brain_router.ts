import { fastBrainStream } from "./fast_brain";
import { runSlowBrain, synthesizeContext } from "./slow_brain";
import { updateEmotion } from "../emotion/emotion_engine";
import { extractMemory, retrieveMemory } from "../memory/memory_agent";
import type { PromptMessage } from "../brain/prompt_builder";

const MAX_HISTORY = 10;
const history: PromptMessage[] = [];

/**
 * Brain Router: dispatches user input to both brains.
 *
 *  ┌─────────┐   stream tokens   ┌──────────┐
 *  │  Router  │ ────────────────► │Fast Brain│ ──► caller
 *  └────┬────┘                    └──────────┘
 *       │  fire-and-forget
 *       └───────────────────────► ┌──────────┐
 *                                 │Slow Brain│ (background)
 *                                 └──────────┘
 *
 * Slow brain NEVER blocks the token stream.
 */
export async function* routeMessage(
  userMessage: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const emotion = updateEmotion(userMessage);

  extractMemory(userMessage);
  const memory = retrieveMemory();

  const slowBrainContext = synthesizeContext();

  let fullReply = "";
  for await (const token of fastBrainStream({
    userMessage,
    emotion,
    memory,
    history: [...history],
    slowBrainContext,
    signal,
  })) {
    fullReply += token;
    yield token;
  }

  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: fullReply });
  while (history.length > MAX_HISTORY) {
    history.shift();
  }

  // Slow brain runs in background — errors are logged, never propagated
  runSlowBrain({
    userMessage,
    assistantReply: fullReply,
    history: [...history],
  }).catch((err) =>
    console.warn("[slow_brain] 后台分析失败:", (err as Error).message),
  );
}

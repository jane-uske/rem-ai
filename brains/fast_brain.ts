import { streamTokens } from "../llm/qwen_client";
import { buildPrompt, type PromptMessage } from "../brain/prompt_builder";
import type { Emotion } from "../emotion/emotion_state";
import type { Memory } from "../memory/memory_store";
import { createLogger } from "../infra/logger";

const logger = createLogger("fast_brain");

export interface FastBrainInput {
  userMessage: string;
  emotion: Emotion;
  memory: Memory[];
  history: PromptMessage[];
  /** 由 Router 从 SlowBrainStore 注入 */
  strategyHints?: string;
  slowBrainContext?: string;
  signal?: AbortSignal;
}

/**
 * Fast Brain: streams LLM tokens with minimum latency.
 * Receives pre-built context so it never waits on slow analysis.
 */
export async function* fastBrainStream(
  input: FastBrainInput,
): AsyncGenerator<string> {
  const priorityParts = [input.strategyHints, input.slowBrainContext].filter(
    (s): s is string => Boolean(s?.trim()),
  );
  const priorityContext =
    priorityParts.length > 0 ? priorityParts.join("\n\n") : undefined;

  const messages = buildPrompt({
    memory: input.memory,
    emotion: input.emotion,
    history: input.history,
    userMessage: input.userMessage,
    priorityContext,
  });

  const configured =
    process.env.key && process.env.base_url && process.env.model;

  if (!configured) {
    yield `嗯…我听到了「${input.userMessage.trim()}」，不过我现在还没连上大脑…等一下就好。`;
    return;
  }

  let hasContent = false;
  try {
    for await (const token of streamTokens(messages, input.signal)) {
      hasContent = true;
      yield token;
    }
    if (!hasContent) {
      logger.warn("LLM 返回内容为空（thinking 已过滤）");
      yield "嗯…让我想想…";
    }
  } catch (err) {
    logger.warn("LLM 调用失败", { error: (err as Error).message });
    yield "啊…出了点问题，等我缓缓再试试…";
  }
}

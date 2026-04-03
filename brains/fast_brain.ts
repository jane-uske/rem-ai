import { streamTokens } from "../llm/qwen_client";
import { buildPrompt, type PromptMessage } from "../brain/prompt_builder";
import type { Emotion } from "../emotion/emotion_state";
import type { Memory } from "../memory/memory_store";

export interface FastBrainInput {
  userMessage: string;
  emotion: Emotion;
  memory: Memory[];
  history: PromptMessage[];
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
  const messages = buildPrompt({
    memory: input.memory,
    emotion: input.emotion,
    history: input.history,
    userMessage: input.userMessage,
  });

  if (input.slowBrainContext) {
    const sys = messages[0];
    if (sys?.role === "system") {
      sys.content +=
        "\n\n── 以下是你对用户的长期观察和记忆，自然地融入对话中，不要逐条复述 ──\n" +
        input.slowBrainContext;
    }
  }

  const configured =
    process.env.key && process.env.base_url && process.env.model;

  if (!configured) {
    yield `嗯…我听到了「${input.userMessage.trim()}」，不过我现在还没连上大脑…等一下就好。`;
    return;
  }

  let hasContent = false;
  try {
    for await (const token of streamTokens(messages)) {
      hasContent = true;
      yield token;
    }
    if (!hasContent) {
      console.warn("[fast_brain] LLM 返回内容为空（thinking 已过滤）");
      yield "嗯…让我想想…";
    }
  } catch (err) {
    console.warn("[fast_brain] LLM 调用失败:", (err as Error).message);
    yield "啊…出了点问题，等我缓缓再试试…";
  }
}

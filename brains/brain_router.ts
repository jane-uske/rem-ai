import { fastBrainStream } from "./fast_brain";
import { trimHistoryToTokenBudget } from "./history_budget";
import { runSlowBrain } from "./slow_brain";
import { extractMemory, retrieveMemory } from "../memory/memory_agent";
import type { PromptMessage } from "../brain/prompt_builder";
import type { Emotion } from "../emotion/emotion_state";
import type { RemSessionContext } from "./rem_session_context";
import { createLogger } from "../infra/logger";

const MAX_HISTORY = 10;
const logger = createLogger("brain_router");

export interface RouteMessageOptions {
  /** 服务端触发的陪伴搭话：不跑记忆提取与慢脑，历史中 user 用短占位 */
  systemTriggered?: boolean;
}

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
  ctx: RemSessionContext,
  userMessage: string,
  emotion: Emotion,
  signal?: AbortSignal,
  opts?: RouteMessageOptions,
): AsyncGenerator<string> {
  if (!opts?.systemTriggered) {
    extractMemory(userMessage, ctx.memory);
  }
  const memory = await retrieveMemory(ctx.memory);

  const slowBrainContext = ctx.slowBrain.synthesizeContext();
  const historyForPrompt = trimHistoryToTokenBudget([...ctx.history]);

  let fullReply = "";
  for await (const token of fastBrainStream({
    userMessage,
    emotion,
    memory,
    history: historyForPrompt,
    slowBrainContext,
    strategyHints: ctx.slowBrain.buildConversationStrategyHints(userMessage),
    signal,
  })) {
    fullReply += token;
    yield token;
  }

  const historyUserContent = opts?.systemTriggered
    ? "［你主动开口陪对方聊天］"
    : userMessage;
  ctx.history.push({ role: "user", content: historyUserContent });
  ctx.history.push({ role: "assistant", content: fullReply });
  while (ctx.history.length > MAX_HISTORY) {
    ctx.history.shift();
  }

  if (!opts?.systemTriggered) {
    runSlowBrain({
      userMessage,
      assistantReply: fullReply,
      history: [...ctx.history],
      slowBrain: ctx.slowBrain,
      memoryRepo: ctx.memory,
    }).catch((err) =>
      logger.warn("后台分析失败", { error: (err as Error).message }),
    );
  }
}

import type { PromptMessage } from "../brain/prompt_builder";
import { EmotionRuntime } from "../emotion/emotion_runtime";
import { InMemoryRepository } from "../memory/memory_store";
import { SlowBrainStore } from "./slow_brain_store";

/**
 * 单条 WebSocket 连接上的 Rem 状态：情绪、慢脑、对话历史、会话内记忆（C1）。
 */
export class RemSessionContext {
  readonly emotion: EmotionRuntime;
  readonly slowBrain: SlowBrainStore;
  readonly memory: InMemoryRepository;
  readonly history: PromptMessage[] = [];

  constructor(readonly connId: string) {
    this.emotion = new EmotionRuntime(connId);
    this.slowBrain = new SlowBrainStore();
    this.memory = new InMemoryRepository();
  }
}

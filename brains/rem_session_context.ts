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
  private slowBrainController: AbortController | null = null;

  constructor(readonly connId: string) {
    this.emotion = new EmotionRuntime(connId);
    this.slowBrain = new SlowBrainStore();
    this.memory = new InMemoryRepository();
  }

  cancelSlowBrain(): void {
    if (!this.slowBrainController) return;
    this.slowBrainController.abort();
    this.slowBrainController = null;
  }

  beginSlowBrain(): AbortSignal {
    this.cancelSlowBrain();
    const controller = new AbortController();
    this.slowBrainController = controller;
    return controller.signal;
  }

  endSlowBrain(signal: AbortSignal): void {
    if (this.slowBrainController?.signal === signal) {
      this.slowBrainController = null;
    }
  }
}

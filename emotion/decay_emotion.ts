import type { EmotionRuntime } from "./emotion_runtime";
import { EmotionLogger } from "../infra/emotion_logger";

const emotionLogger = new EmotionLogger();

/**
 * 回复后削弱情绪惯性；强度不足时回到 neutral。
 */
export function decayEmotion(runtime: EmotionRuntime): void {
  const before = runtime.getEmotion();
  runtime.weakenEmotionAfterReply();
  const after = runtime.getEmotion();
  if (before !== after) {
    emotionLogger.log({
      userId: runtime.connId,
      fromEmotion: before,
      toEmotion: after,
      trigger: "decay",
    });
  }
}

import type { Emotion } from "./emotion_state";
import { getEmotion, setEmotion } from "./emotion_state";
import { EmotionLogger } from "../infra/emotion_logger";

const emotionLogger = new EmotionLogger();

const DECAY_MAP: Record<Emotion, Emotion> = {
  happy: "neutral",
  curious: "neutral",
  shy: "neutral",
  sad: "neutral",
  neutral: "neutral",
};

/**
 * 回复后轻微回归 neutral。
 */
export function decayEmotion(): void {
  const current = getEmotion();
  const next = DECAY_MAP[current];
  if (next !== current) {
    setEmotion(next);
    emotionLogger.log({
      userId: "dev",
      fromEmotion: current,
      toEmotion: next,
      trigger: "decay",
    });
  }
}

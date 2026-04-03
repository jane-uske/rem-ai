import { createLogger } from "../infra/logger";

export type Emotion = "neutral" | "happy" | "curious" | "shy" | "sad";

const logger = createLogger("emotion_state");

let currentEmotion: Emotion = "neutral";

export function getEmotion(): Emotion {
  return currentEmotion;
}

export function setEmotion(emotion: Emotion): void {
  if (currentEmotion !== emotion) {
    logger.info("情绪变化", { from: currentEmotion, to: emotion });
  }
  currentEmotion = emotion;
}

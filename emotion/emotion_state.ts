export type Emotion = "neutral" | "happy" | "curious" | "shy" | "sad";

let currentEmotion: Emotion = "neutral";

export function getEmotion(): Emotion {
  return currentEmotion;
}

export function setEmotion(emotion: Emotion): void {
  if (currentEmotion !== emotion) {
    console.log(`[emotion] ${currentEmotion} → ${emotion}`);
  }
  currentEmotion = emotion;
}

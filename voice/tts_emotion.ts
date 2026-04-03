import type { Emotion } from "../emotion/emotion_state";

export type { Emotion };

export interface EmotionVoiceParams {
  rate: string;
  pitch: string;
  lengthScale: number;
  noiseScale: number;
  speed: number;
}

const EMOTION_VOICE_MAP: Record<Emotion, EmotionVoiceParams> = {
  neutral: { rate: "default", pitch: "default", lengthScale: 1.0, noiseScale: 0.667, speed: 1.0 },
  happy: { rate: "+12%", pitch: "+8Hz", lengthScale: 0.9, noiseScale: 0.8, speed: 1.1 },
  curious: { rate: "+5%", pitch: "+12Hz", lengthScale: 0.95, noiseScale: 0.75, speed: 1.05 },
  shy: { rate: "-8%", pitch: "-3Hz", lengthScale: 1.1, noiseScale: 0.5, speed: 0.92 },
  sad: { rate: "-15%", pitch: "-8Hz", lengthScale: 1.2, noiseScale: 0.4, speed: 0.85 },
};

export function getEmotionVoiceParams(emotion: Emotion): EmotionVoiceParams {
  return EMOTION_VOICE_MAP[emotion];
}

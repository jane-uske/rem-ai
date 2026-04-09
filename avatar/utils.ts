import type {
  Emotion,
  AvatarIntentGesture,
  AvatarIntentFacialAccent,
} from "./types";

/**
 * Validate and normalize an emotion value, returns fallback if invalid
 */
export function asEmotion(value: unknown, fallback: Emotion = "neutral"): Emotion {
  return value === "happy" ||
    value === "curious" ||
    value === "shy" ||
    value === "sad" ||
    value === "neutral"
    ? value as Emotion
    : fallback;
}

/**
 * Validate and normalize a gesture value, returns fallback if invalid
 */
export function asGesture(value: unknown, fallback: AvatarIntentGesture = "none"): AvatarIntentGesture {
  switch (value) {
    case "happy_hop":
    case "nod":
    case "shake_head":
    case "wave":
    case "tilt_head":
    case "shrug":
    case "lean_in":
    case "recoil":
    case "shrink_in":
    case "none":
      return value as AvatarIntentGesture;
    default:
      return fallback;
  }
}

/**
 * Validate and normalize a facial accent value, returns fallback if invalid
 */
export function asFacialAccent(
  value: unknown,
  fallback: AvatarIntentFacialAccent = "none",
): AvatarIntentFacialAccent {
  switch (value) {
    case "brow_furrow":
    case "brow_raise":
    case "soft_smile":
    case "sad_mouth":
    case "none":
      return value as AvatarIntentFacialAccent;
    default:
      return fallback;
  }
}

/**
 * Clamp a numeric value to 0-3 band, used for intensity/energy values
 */
export function clampBand(value: unknown, fallback: 0 | 1 | 2 | 3 = 0): 0 | 1 | 2 | 3 {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  if (value <= 1) return 1;
  if (value <= 2) return 2;
  return 3;
}

/**
 * Clamp a millisecond value between min and max, returns fallback if invalid
 */
export function clampMs(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export type Emotion =
  | "neutral"
  | "happy"
  | "sad"
  | "gentle"
  | "thinking"
  | "surprised";

export type Motion =
  | "idle"
  | "nod"
  | "wave"
  | "thinking"
  | "shake_head";

export type RemState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

export type AvatarCommand = {
  text: string;
  emotion: Emotion;
  motion: Motion;
  interruptible: boolean;
};

export const EMOTIONS: readonly Emotion[] = [
  "neutral",
  "happy",
  "sad",
  "gentle",
  "thinking",
  "surprised",
] as const;

export const MOTIONS: readonly Motion[] = [
  "idle",
  "nod",
  "wave",
  "thinking",
  "shake_head",
] as const;

export const REM_STATES: readonly RemState[] = [
  "idle",
  "listening",
  "thinking",
  "speaking",
] as const;

export function isEmotion(v: string): v is Emotion {
  return (EMOTIONS as readonly string[]).includes(v);
}

export function isMotion(v: string): v is Motion {
  return (MOTIONS as readonly string[]).includes(v);
}

export function isRemState(v: string): v is RemState {
  return (REM_STATES as readonly string[]).includes(v);
}


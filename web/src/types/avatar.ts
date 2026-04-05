export type RemState = "idle" | "listening" | "thinking" | "speaking";

export type AvatarActionCommand = {
  action: string;
  intensity: number;
  duration: number;
};

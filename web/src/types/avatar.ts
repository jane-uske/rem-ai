import type { Viseme } from "../../../avatar/types";

export type RemState = "idle" | "listening" | "thinking" | "speaking";

export type AvatarEngine = "vrm";

export type AvatarModelPreset = "rem" | "seed-san";

export type AvatarActionCommand = {
  action: string;
  intensity: number;
  duration: number;
};

export type LipSignal = {
  envelope: number;
  active: boolean;
  viseme?: {
    name: Viseme;
    weight: number;
  } | null;
};

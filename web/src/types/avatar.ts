import type {
  AvatarIntent,
  AvatarIntentFacialAccent,
  AvatarIntentGesture,
  AvatarIntentSource,
  AvatarIntentBeat,
  Emotion,
  FaceParams,
  LipSyncFrame,
  Viseme,
} from "../../../avatar/types";

export type RemState = "idle" | "listening" | "thinking" | "speaking";

export type AvatarEngine = "vrm";

export type AvatarModelPreset = "rem" | "seed-san";

export type AvatarActionCommand = {
  action: string;
  intensity: number;
  duration: number;
};

export type AvatarFaceOverlay = Partial<FaceParams>;

export type {
  AvatarIntent,
  AvatarIntentBeat,
  AvatarIntentFacialAccent,
  AvatarIntentGesture,
  AvatarIntentSource,
};

export type AvatarFrameState = {
  emotion?: Emotion;
  face?: AvatarFaceOverlay;
  lipSync?: LipSyncFrame;
  lipSyncAtMs?: number;
};

export type LipSignal = {
  envelope: number;
  active: boolean;
  viseme?: {
    name: Viseme;
    weight: number;
  } | null;
};

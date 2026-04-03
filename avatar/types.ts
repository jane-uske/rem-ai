export type Emotion = "neutral" | "happy" | "curious" | "shy" | "sad";

export interface FaceParams {
  eyeOpenL: number;
  eyeOpenR: number;
  eyeSquintL: number;
  eyeSquintR: number;
  browUpL: number;
  browUpR: number;
  browDownL: number;
  browDownR: number;
  mouthSmile: number;
  mouthFrown: number;
  mouthOpen: number;
  mouthPucker: number;
  cheekPuff: number;
}

export type Viseme =
  | "sil"
  | "aa"
  | "ee"
  | "ih"
  | "oh"
  | "oo"
  | "ss"
  | "sh"
  | "ff"
  | "th"
  | "nn"
  | "rr"
  | "dd"
  | "kk"
  | "pp"
  | "ch";

export interface LipSyncFrame {
  time: number;
  viseme: Viseme;
  weight: number;
}

export interface ActionCommand {
  action: string;
  intensity: number;
  duration: number;
}

export interface AvatarFrame {
  face?: Partial<FaceParams>;
  lipSync?: LipSyncFrame;
  action?: ActionCommand;
  emotion?: Emotion;
}

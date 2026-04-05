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

export type AvatarPhase = "idle" | "speaking";

export type AvatarCommand =
  | {
      kind: "set_emotion";
      emotion: Emotion;
      transitionMs?: number;
    }
  | {
      kind: "play_action";
      action: ActionCommand;
    }
  | {
      kind: "set_phase";
      phase: AvatarPhase;
      reason?: "tts_start" | "tts_end" | "interrupt" | "startup";
    };

export type RemServerMessage =
  | {
      type: "emotion";
      emotion: Emotion;
    }
  | {
      type: "chat_chunk";
      content: string;
      generationId: number;
    }
  | {
      type: "chat_end";
      emotion?: Emotion;
      content?: string;
      generationId: number;
    }
  | {
      type: "voice";
      audio: string;
      generationId: number;
    }
  | {
      type: "voice_pcm_chunk";
      audio: string;
      sampleRate: number;
      channels: 1;
      bitsPerSample: 16;
      generationId: number;
    }
  | {
      type: "interrupt";
      generationId?: number;
    }
  | {
      type: "stt_partial";
      content: string;
    }
  | {
      type: "stt_final";
      content: string;
    }
  | {
      type: "vad_start";
    }
  | {
      type: "vad_end";
    }
  | {
      type: "avatar_frame";
      frame: AvatarFrame;
    }
  | {
      type: "avatar_command";
      command: AvatarCommand;
    }
  | {
      type: "avatar_state";
      phase: AvatarPhase;
    }
  | {
      type: "error";
      content: string;
    };

export type RemServerMessageType = RemServerMessage["type"];

import type { AvatarFrame } from "../../avatar/types";

export type ServerMessageType =
  | "emotion"
  | "chat_chunk"
  | "chat_end"
  | "voice"
  | "interrupt"
  | "stt_partial"
  | "stt_final"
  | "vad_start"
  | "vad_end"
  | "avatar_frame"
  | "error";

export interface ServerMessage {
  type: ServerMessageType;
  content?: string;
  emotion?: string;
  audio?: string;
  frame?: AvatarFrame;
}

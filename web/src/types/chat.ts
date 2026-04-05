import type {
  AvatarCommand,
  AvatarFrame,
  AvatarPhase,
  Emotion,
  RemServerMessage,
} from "../../../avatar/types";

export type MessageRole = "user" | "rem" | "partial" | "error" | "sys";

export type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
};

export type RemChatEmotion = Emotion;
export type RemAvatarCommand = AvatarCommand;
export type RemAvatarFrame = AvatarFrame;
export type RemAvatarPhase = AvatarPhase;
export type RemServerWsMessage = RemServerMessage;

import type { AvatarFrame } from "../../avatar/types";

export interface ServerMessage {
  type: string;
  content?: string;
  emotion?: string;
  audio?: string;
  frame?: AvatarFrame;
}

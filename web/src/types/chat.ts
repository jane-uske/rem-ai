export type MessageRole = "user" | "rem" | "error" | "sys";

export type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
};

"use client";

import type { MessageRole } from "@/types/chat";

export type MessageBubbleProps = {
  role: MessageRole;
  children: string;
};

const base =
  "rem-msg-pop max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed";

const styles: Record<MessageRole, string> = {
  rem: "self-start rounded-bl-md bg-[var(--rem-surface)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.35)]",
  user:
    "self-end rounded-br-md bg-[var(--rem-user-bg)] text-[var(--rem-user-fg)]",
  error:
    "self-center rounded-lg bg-[var(--rem-error-bg)] px-3 py-2 text-[13px] text-[var(--rem-danger)]",
  sys: "self-center bg-transparent px-0 py-1 text-xs text-[var(--rem-dim)]",
};

export function MessageBubble({ role, children }: MessageBubbleProps) {
  return (
    <div className={`${base} ${styles[role]}`}>{children}</div>
  );
}

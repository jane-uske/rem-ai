"use client";

import type { MessageRole } from "@/types/chat";

export type MessageBubbleProps = {
  role: MessageRole;
  children: string;
};

const base =
  "rem-msg-bubble rem-msg-pop max-w-[min(92%,32rem)] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed tracking-tight min-[480px]:max-w-[min(85%,32rem)] min-[480px]:px-4 min-[480px]:py-3";

const styles: Record<MessageRole, string> = {
  rem:
    "self-start rounded-bl-md border border-white/12 bg-[var(--rem-bubble-rem)] text-[var(--foreground)] shadow-md backdrop-blur-md dark:border-white/10",
  user:
    "self-end rounded-br-md border border-[var(--rem-accent)]/30 bg-[var(--rem-user-bg)] text-[var(--rem-user-fg)] shadow-md backdrop-blur-sm",
  partial:
    "self-end rounded-br-md border border-white/20 bg-white/5 text-[var(--rem-dim)] shadow-sm backdrop-blur-sm italic",
  error:
    "self-center rounded-xl border border-[var(--rem-danger)]/30 bg-[var(--rem-error-bg)] px-4 py-2.5 text-[13px] text-[var(--rem-danger)]",
  sys: "self-center bg-transparent px-1 py-1 text-center text-[11px] text-[var(--rem-dim)]",
};

const speakerLine: Record<MessageRole, string> = {
  rem: "Rem",
  user: "你",
  partial: "你（识别中）",
  error: "Error",
  sys: "System",
};

export function MessageBubble({ role, children }: MessageBubbleProps) {
  return (
    <div className={`${base} ${styles[role]}`} role="article">
      <span className="sr-only">{speakerLine[role]}: </span>
      {children}
    </div>
  );
}

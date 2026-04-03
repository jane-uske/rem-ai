"use client";

import { useCallback, useState } from "react";

export type InputBarProps = {
  onSend: (text: string) => void;
  onMicToggle: () => void;
  disabled: boolean;
  micDisabled: boolean;
  recording: boolean;
  placeholder: string;
};

export function InputBar({
  onSend,
  onMicToggle,
  disabled,
  micDisabled,
  recording,
  placeholder,
}: InputBarProps) {
  const [value, setValue] = useState("");

  const submit = useCallback(() => {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue("");
  }, [value, disabled, onSend]);

  return (
    <div className="mx-auto flex w-full max-w-2xl items-center gap-2.5">
      <button
        type="button"
        title="语音输入"
        disabled={micDisabled}
        onClick={onMicToggle}
        className={
          recording
            ? "rem-mic-pulse flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-transparent bg-[var(--rem-danger)] text-lg text-white disabled:cursor-default disabled:opacity-40"
            : "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-transparent bg-[var(--rem-mic-bg)] text-lg text-[var(--rem-accent)] disabled:cursor-default disabled:opacity-40"
        }
      >
        {recording ? "■" : "🎤"}
      </button>
      <input
        className="min-w-0 flex-1 rounded-full border border-[var(--rem-border)] bg-[var(--rem-input)] px-[18px] py-2.5 text-sm text-[var(--foreground)] outline-none transition-[border-color] placeholder:text-[var(--rem-dim)] focus:border-[var(--rem-accent)] disabled:opacity-60"
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={submit}
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-[var(--rem-accent)] text-lg text-white disabled:cursor-default disabled:opacity-40"
      >
        ↑
      </button>
    </div>
  );
}

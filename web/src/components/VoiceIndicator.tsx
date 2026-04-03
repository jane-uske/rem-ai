"use client";

export type VoiceIndicatorProps = {
  active: boolean;
};

export function VoiceIndicator({ active }: VoiceIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-2 rounded-xl border border-[var(--rem-border)] bg-[var(--rem-input)] px-3 py-1.5"
    >
      <div
        className="rem-voice-bars flex h-10 items-end justify-center gap-1"
        data-active={active ? "true" : "false"}
        aria-hidden
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="rem-voice-bar inline-block w-[5px] self-end rounded-sm bg-[var(--rem-dot-off)] transition-colors"
          />
        ))}
      </div>
      <span className="whitespace-nowrap text-[11px] text-[var(--rem-dim)]">
        {active ? "播放中" : ""}
      </span>
    </div>
  );
}

const EMOTION_LABELS: Record<string, string> = {
  neutral: "中性",
  happy: "开心",
  curious: "好奇",
  shy: "害羞",
  sad: "难过",
};

export function getEmotionLabel(emotion: string): string {
  const normalized = String(emotion ?? "").trim().toLowerCase();
  const label = EMOTION_LABELS[normalized];
  if (label) return label;
  if (!normalized) return "中性";
  return normalized;
}

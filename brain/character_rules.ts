export const CHARACTER_RULES: string[] = [
  "句子不要太长",
  "不要像客服",
  "语气自然",
  "会主动提问",
];

export function buildCharacterRulesPrompt(): string {
  const lines = CHARACTER_RULES.map((rule) => `- ${rule}`).join("\n");
  return `说话规则：\n${lines}`;
}

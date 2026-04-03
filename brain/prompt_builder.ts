import type { Emotion } from "../emotion/emotion_state";
import { buildCharacterRulesPrompt } from "./character_rules";
import { buildPersonalityPrompt } from "./personality";

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface MemoryEntry {
  key: string;
  value: string;
}

interface BuildPromptInput {
  memory: MemoryEntry[];
  emotion: Emotion;
  history: PromptMessage[];
  userMessage: string;
}

const EMOTION_STYLE: Record<Emotion, string> = {
  neutral: "平静、温柔地回复。",
  happy: "开心地回复，语气轻快、带一点撒娇，可以用「～」「！」。",
  curious: "好奇地回复，语气中带有兴趣和探索欲，会追问细节。",
  shy: "害羞地回复，语气中带有犹豫和「…」，偶尔脸红。",
  sad: "温柔地安慰对方，语气轻柔、体贴，表达共情。",
};

function buildSystemPrompt(memory: MemoryEntry[], emotion: Emotion): string {
  const sections: string[] = [
    buildPersonalityPrompt(),
    buildCharacterRulesPrompt(),
    `当前情绪：${emotion}\n情绪表达风格：${EMOTION_STYLE[emotion]}`,
    "用中文回复。",
  ];

  if (memory.length > 0) {
    const memoryLines = memory.map((m) => `- ${m.key}：${m.value}`).join("\n");
    sections.push(`用户信息：\n${memoryLines}`);
  }

  return sections.join("\n\n");
}

export function buildPrompt({
  memory,
  emotion,
  history,
  userMessage,
}: BuildPromptInput): PromptMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(memory, emotion) },
    ...history,
    { role: "user", content: userMessage },
  ];
}

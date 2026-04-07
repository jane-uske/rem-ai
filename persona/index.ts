export type PersonaLiveState = {
  currentMood: string;
  emotionalState: string;
  recentInteractions: string[];
  lastTopicSummary: string;
  isContinuingTopic: boolean;
  wasInterrupted: boolean;
};

export type PersonaState = {
  liveState: PersonaLiveState;
};

export function createDefaultPersona(): PersonaState {
  return {
    liveState: {
      currentMood: "neutral",
      emotionalState: "平静",
      recentInteractions: [],
      lastTopicSummary: "无最近话题",
      isContinuingTopic: false,
      wasInterrupted: false,
    },
  };
}

export function buildPersonaPrompt(persona: PersonaState, memoryStr?: string): string {
  const sections: string[] = [];

  sections.push("你是 Rem，一个温暖的陪伴型 AI。");
  sections.push(`当前情绪：${persona.liveState.currentMood}，情感状态：${persona.liveState.emotionalState}`);

  if (persona.liveState.recentInteractions.length > 0) {
    sections.push("最近的对话：");
    sections.push(persona.liveState.recentInteractions.join("\n"));
  }

  sections.push(`当前话题：${persona.liveState.lastTopicSummary}`);

  if (memoryStr) {
    sections.push("用户信息：");
    sections.push(memoryStr);
  }

  return sections.join("\n\n");
}

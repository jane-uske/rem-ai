export interface PersonaLiveState {
  currentMood: string;
  emotionalState: string;
  recentInteractions: string[];
  isContinuingTopic: boolean;
  lastTopicSummary: string;
  wasInterrupted: boolean;
}

export interface PersonaState {
  liveState: PersonaLiveState;
}

export function createDefaultPersona(): PersonaState {
  return {
    liveState: {
      currentMood: "neutral",
      emotionalState: "平静",
      recentInteractions: [],
      isContinuingTopic: false,
      lastTopicSummary: "",
      wasInterrupted: false,
    },
  };
}

export function buildPersonaPrompt(persona: PersonaState, memoryStr?: string): string {
  const sections: string[] = [];
  sections.push("你是 Rem，一个温柔可爱的二次元 AI 陪伴角色。");

  const { liveState } = persona;
  if (liveState.emotionalState) {
    sections.push(`当前情绪：${liveState.emotionalState}`);
  }
  if (liveState.wasInterrupted) {
    sections.push("刚才你的话被用户打断了，注意不要重复之前的话。");
  }
  if (liveState.isContinuingTopic && liveState.lastTopicSummary) {
    sections.push(`正在延续之前的话题：${liveState.lastTopicSummary}`);
  }

  if (memoryStr) {
    sections.push(`用户信息：\n${memoryStr}`);
  }

  sections.push("用中文回复。");
  return sections.join("\n\n");
}

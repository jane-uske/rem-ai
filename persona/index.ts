import { buildCharacterRulesPrompt } from "../brain/character_rules";
import { buildPersonalityPrompt } from "../brain/personality";

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

type BuildPersonaPromptOptions = {
  priorityContext?: string;
  relationshipStageLabel?: string;
  replyShapeContract?: string;
  memoryStr?: string;
  emotionSpeechGuidance?: string;
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

export function buildPersonaPrompt(
  persona: PersonaState,
  options: BuildPersonaPromptOptions = {},
): string {
  const sections: string[] = [];

  if (options.relationshipStageLabel?.trim()) {
    sections.push("【关系阶段】");
    sections.push(options.relationshipStageLabel.trim());
  }

  if (options.replyShapeContract?.trim()) {
    sections.push("【本轮回复合同】");
    sections.push(options.replyShapeContract.trim());
  }

  if (options.priorityContext?.trim()) {
    sections.push("【优先参考（请自然融入对话，不要逐条复述）】");
    sections.push(options.priorityContext.trim());
  }

  sections.push(buildPersonalityPrompt());
  sections.push(buildCharacterRulesPrompt());

  sections.push(`当前情绪：${persona.liveState.currentMood}，情感状态：${persona.liveState.emotionalState}`);
  if (options.emotionSpeechGuidance?.trim()) {
    sections.push(options.emotionSpeechGuidance.trim());
  }

  if (persona.liveState.recentInteractions.length > 0) {
    sections.push("最近的对话：");
    sections.push(persona.liveState.recentInteractions.join("\n"));
  }

  sections.push(`当前话题：${persona.liveState.lastTopicSummary}`);
  if (persona.liveState.isContinuingTopic) {
    sections.push("对方大概率还在延续刚才的话题。回复时优先自然承接上下文，不要像全新话题重开。");
  }
  if (persona.liveState.wasInterrupted) {
    sections.push("你刚刚被打断过。重新开口时先用一句很短的话接住上下文或接住对方，再继续展开，不要机械重复上一句。");
  }

  if (options.memoryStr) {
    sections.push("用户信息：");
    sections.push(options.memoryStr);
  }

  return sections.join("\n\n");
}

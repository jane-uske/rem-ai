import type { PromptMessage } from "../brain/prompt_builder";
import { EmotionRuntime } from "../emotion/emotion_runtime";
import { SessionMemoryOverlayRepository } from "../memory/session_memory_overlay";
import { SlowBrainStore } from "./slow_brain_store";
import { createDefaultPersona, type PersonaState } from "../persona";

/**
 * 单条 WebSocket 连接上的 Rem 状态：情绪、慢脑、对话历史、会话内记忆（C1）。
 */
export class RemSessionContext {
  readonly emotion: EmotionRuntime;
  readonly slowBrain: SlowBrainStore;
  readonly memory: SessionMemoryOverlayRepository;
  readonly history: PromptMessage[] = [];
  readonly persona: PersonaState;
  private slowBrainController: AbortController | null = null;
  /** 最后一次被打断的AI回复内容，用于回答「刚才说到哪了」 */
  lastInterruptedReply: string | null = null;
  /** 当前正在生成中的 AI 回复草稿，用于打断瞬间承接上下文。 */
  currentAssistantDraft: string | null = null;

  constructor(readonly connId: string) {
    this.emotion = new EmotionRuntime(connId);
    this.slowBrain = new SlowBrainStore();
    this.memory = new SessionMemoryOverlayRepository();
    this.persona = createDefaultPersona();
  }

  cancelSlowBrain(): void {
    if (!this.slowBrainController) return;
    this.slowBrainController.abort();
    this.slowBrainController = null;
  }

  /**
   * 只在真实用户打断时调用，不能由后台慢脑取消来触发。
   */
  markInterrupted(): void {
    this.persona.liveState.wasInterrupted = true;
  }

  beginSlowBrain(): AbortSignal {
    this.cancelSlowBrain();
    const controller = new AbortController();
    this.slowBrainController = controller;
    return controller.signal;
  }

  endSlowBrain(signal: AbortSignal): void {
    if (this.slowBrainController?.signal === signal) {
      this.slowBrainController = null;
    }
  }

  /**
   * 从文本中提取关键词（轻量规则版）
   * @param text 输入文本
   * @returns 关键词数组
   */
  private extractKeywords(text: string): string[] {
    // 去掉语气词、助词，提取名词、动词、形容词
    const stopWords = new Set(["的", "了", "啊", "哦", "嗯", "呀", "呢", "吗", "吧", "我", "你", "他", "她", "它", "我们", "你们", "他们", "是", "有", "在", "要", "去", "哦", "嗯"]);
    // 简单分词：按空格和标点分割，过滤短词和停用词
    return text
      .replace(/[\p{P}]/gu, " ")
      .split(/\s+/)
      .filter(word => word.length > 1 && !stopWords.has(word))
      .map(word => word.toLowerCase());
  }

  /**
   * 自动生成最近话题摘要（轻量规则版，无模型依赖）
   * @returns 话题摘要字符串
   */
  private generateTopicSummary(): string {
    const recent = this.persona.liveState.recentInteractions.slice(-4); // 取最近4轮
    if (recent.length === 0) return "无最近话题";
    
    // 提取所有内容
    const content = recent.map(line => line.replace(/^(用户|你)：/, "")).join(" ");
    const keywords = this.extractKeywords(content);
    
    if (keywords.length === 0) return "闲聊";
    // 最多取5个关键词组成摘要
    return keywords.slice(0, 5).join("、");
  }

  /**
   * 自动判断是否延续上一话题
   * @param currentUserInput 当前用户输入
   * @returns 是否延续上一话题
   */
  private isContinuingPreviousTopic(currentUserInput?: string): boolean {
    // 没有当前输入或者没有历史对话，不算延续
    if (!currentUserInput || this.persona.liveState.recentInteractions.length === 0) {
      return false;
    }

    // 匹配明确的延续话术
    const continuationPhrases = ["继续说", "刚才说到哪", "接着说", "然后呢", "还有吗", "之前说的", "刚才的话题", "继续刚才的"];
    const inputLower = currentUserInput.toLowerCase();
    if (continuationPhrases.some(phrase => inputLower.includes(phrase))) {
      return true;
    }

    // 计算关键词重叠度
    const currentKeywords = this.extractKeywords(currentUserInput);
    if (currentKeywords.length === 0) return false;

    // 提取最近3轮对话的关键词
    const recentContent = this.persona.liveState.recentInteractions.slice(-3)
      .map(line => line.replace(/^(用户|你)：/, ""))
      .join(" ");
    const recentKeywords = this.extractKeywords(recentContent);
    const recentKeywordSet = new Set(recentKeywords);

    // 重叠关键词数量
    const overlap = currentKeywords.filter(keyword => recentKeywordSet.has(keyword)).length;
    // 重叠度超过30%就算延续
    return overlap / currentKeywords.length > 0.3;
  }

  /**
   * Update live persona state after each interaction
   * @param mood New current mood
   * @param lastUserMessage Last user message to add to recent interactions
   * @param lastAssistantReply Last assistant reply to add to recent interactions
   */
  updateLiveState(
    mood?: string,
    lastUserMessage?: string,
    lastAssistantReply?: string,
  ): void {
    // Update mood if provided
    if (mood) {
      this.persona.liveState.currentMood = mood;
      this.persona.liveState.emotionalState = mood === "neutral" ? "平静" : 
        mood === "happy" ? "开心" : 
        mood === "curious" ? "好奇" : 
        mood === "shy" ? "害羞" : 
        mood === "sad" ? "难过" : "平静";
    }

    // Keep last 3 interactions in recentInteractions
    if (lastUserMessage) {
      this.persona.liveState.recentInteractions.push(`用户：${lastUserMessage}`);
      if (this.persona.liveState.recentInteractions.length > 6) {
        this.persona.liveState.recentInteractions.shift();
      }
    }
    if (lastAssistantReply) {
      this.persona.liveState.recentInteractions.push(`你：${lastAssistantReply}`);
      if (this.persona.liveState.recentInteractions.length > 6) {
        this.persona.liveState.recentInteractions.shift();
      }
    }

    // 自动更新话题延续标记
    this.persona.liveState.isContinuingTopic = this.isContinuingPreviousTopic(lastUserMessage);
    // 自动生成话题摘要
    this.persona.liveState.lastTopicSummary = this.generateTopicSummary();
    // 重置打断标记，打断状态仅生效一轮对话
    this.persona.liveState.wasInterrupted = false;
  }
}

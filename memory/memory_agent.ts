import { addMemory, getAllMemories, Memory } from "./memory_store";
import { createLogger } from "../infra/logger";

const logger = createLogger("memory_agent");

interface MemoryPattern {
  pattern: RegExp;
  key: string;
  isNegative?: boolean;
}

const PATTERNS: MemoryPattern[] = [
  { pattern: /我(?:叫|的名字是)\s*([^\s，。！？,.!?]+)/, key: "名字" },
  { pattern: /我住在\s*([^\s，。！？,.!?]+)/, key: "城市" },
  { pattern: /我在\s*([^\s，。！？,.!?]+)\s*住/, key: "城市" },
  { pattern: /我(?:今年|)\s*(\d+)\s*岁/, key: "年龄" },
  { pattern: /我的工作是\s*([^\s，。！？,.!?]+)/, key: "工作" },
  { pattern: /我是(?:做|干)\s*(.+?)(?:的|[，。！？,.!?]|$)/, key: "工作" },
  { pattern: /我喜欢\s*(.+?)(?:[，。！？,.!?]|$)/, key: "喜好" },
  { pattern: /我不喜欢\s*(.+?)(?:[，。！？,.!?]|$)/, key: "不喜好", isNegative: true },
  { pattern: /我讨厌\s*(.+?)(?:[，。！？,.!?]|$)/, key: "不喜好", isNegative: true },
  { pattern: /我(?:有|养了?)(?:一?只|一?条)?\s*([^\s，。！？,.!?猫狗鸟鱼]+[猫狗鸟鱼]?)/, key: "宠物" },
  { pattern: /我的?(?:猫|狗|宠物)叫?\s*([^\s，。！？,.!?]+)/, key: "宠物名字" },
  { pattern: /我每天\s*([^\s，。！？,.!?]+)/, key: "日常习惯" },
  { pattern: /我(?:家人|家里|爸爸|妈妈|老爸|老妈|哥|姐|弟|妹)/, key: "家庭" },
  { pattern: /我来自\s*([^\s，。！？,.!?]+)/, key: "故乡" },
  { pattern: /我的老家在\s*([^\s，。！？,.!?]+)/, key: "故乡" },
  { pattern: /我(?:的?专业|学的?是)\s*([^\s，。！？,.!?]+)/, key: "专业" },
  { pattern: /我在\s*([^\s，。！？,.!?]+)\s*(?:上学|读书|念书)/, key: "学校" },
];

const NEGATION_WORDS = ["不", "没有", "别", "不是", "没"];

function hasNegationBeforeMatch(msg: string, matchIndex: number): boolean {
  const beforeMatch = msg.slice(0, matchIndex);
  return NEGATION_WORDS.some((neg) => beforeMatch.includes(neg));
}

export function extractMemory(userMessage: string): void {
  for (const { pattern, key, isNegative } of PATTERNS) {
    const match = userMessage.match(pattern);
    if (match?.[0] && match?.[1]) {
      if (!isNegative && hasNegationBeforeMatch(userMessage, match.index || 0)) {
        continue;
      }
      const value = match[1].trim();
      if (value) {
        addMemory(key, value);
        logger.info("记住了", { key, value });
      }
    }
  }
}

export async function retrieveMemory(): Promise<Memory[]> {
  return getAllMemories();
}

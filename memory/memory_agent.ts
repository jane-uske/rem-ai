import { addMemory, getAllMemories, Memory } from "./memory_store";

const PATTERNS: { pattern: RegExp; key: string }[] = [
  { pattern: /我(?:叫|的名字是)\s*([^\s，。！？,.!?]+)/, key: "名字" },
  { pattern: /我住在\s*([^\s，。！？,.!?]+)/, key: "城市" },
  { pattern: /我在\s*([^\s，。！？,.!?]+)\s*住/, key: "城市" },
  { pattern: /我(?:今年|)\s*(\d+)\s*岁/, key: "年龄" },
  { pattern: /我的工作是\s*([^\s，。！？,.!?]+)/, key: "工作" },
  { pattern: /我是(?:做|干)\s*(.+?)(?:的|[，。！？,.!?]|$)/, key: "工作" },
  { pattern: /我喜欢\s*(.+?)(?:[，。！？,.!?]|$)/, key: "喜好" },
];

export function extractMemory(userMessage: string): void {
  for (const { pattern, key } of PATTERNS) {
    const match = userMessage.match(pattern);
    if (match?.[1]) {
      const value = match[1].trim();
      if (value) {
        addMemory(key, value);
        console.log(`[memory] 记住了：${key} = ${value}`);
      }
    }
  }
}

export function retrieveMemory(): Memory[] {
  return getAllMemories();
}

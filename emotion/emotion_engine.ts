import { Emotion, getEmotion, setEmotion } from "./emotion_state";
import { EmotionLogger } from "../infra/emotion_logger";

const emotionLogger = new EmotionLogger();

interface EmotionRule {
  emotion: Emotion;
  keywords: string[];
}

const RULES: EmotionRule[] = [
  {
    emotion: "happy",
    keywords: [
      "好棒", "喜欢你", "真厉害", "太好了", "谢谢", "感谢",
      "可爱", "爱你", "开心", "好开心", "你真好", "棒",
      "优秀", "厉害", "不错", "赞", "好喜欢", "超喜欢",
      "高兴", "太赞了", "真不错", "太可爱了", "哈哈", "hhh",
      "笑死", "乐死", "幸福", "太好了吧", "nice", "great",
      "good", "awesome", "love", "yay", "😂", "😄", "😊", "🥳", "😍",
    ],
  },
  {
    emotion: "curious",
    keywords: [
      "为什么", "怎么", "什么是", "是什么", "如何", "能不能",
      "可以吗", "告诉我", "解释", "请问", "好奇", "想知道",
      "？", "?", "吗", "呢", "咋", "为何", "哪一个", "哪种",
      "如何做", "怎么做", "教我", "说说", "展开讲讲",
    ],
  },
  {
    emotion: "sad",
    keywords: [
      "难过", "伤心", "不开心", "烦", "累了", "好烦",
      "讨厌", "生气", "失望", "孤独", "寂寞", "无聊",
      "不想", "不好", "糟糕", "痛苦", "崩溃", "算了",
      "郁闷", "emo", "抑郁", "很丧", "沮丧", "烦死了",
      "太难了", "不行了", "想哭", "哭了", "😭", "😢", "😞", "💔",
    ],
  },
  {
    emotion: "shy",
    keywords: [
      "好害羞", "害羞", "脸红", "嘿嘿", "亲亲", "抱抱",
      "摸摸头", "牵手", "撒娇", "哼",
      "夸我", "你夸夸我", "想你", "贴贴", "啵啵", "///", "(*^_^*)",
    ],
  },
];

export function updateEmotion(userMessage: string): Emotion {
  const msg = userMessage.trim();
  const fromEmotion = getEmotion();
  let toEmotion: Emotion = "neutral";

  if (!msg) {
    toEmotion = "neutral";
  } else {
    let found = false;
    for (const rule of RULES) {
      if (rule.keywords.some((kw) => msg.includes(kw))) {
        toEmotion = rule.emotion;
        found = true;
        break;
      }
    }
    if (!found) {
      if (/[？?]/.test(msg)) {
        toEmotion = "curious";
      } else if (/[!！]/.test(msg)) {
        toEmotion = "happy";
      } else {
        toEmotion = "neutral";
      }
    }
  }

  setEmotion(toEmotion);

  const trigger = userMessage.length > 50 ? userMessage.slice(0, 50) : userMessage;
  emotionLogger.log({
    userId: "dev",
    fromEmotion,
    toEmotion,
    trigger,
  });

  return toEmotion;
}

const DECAY_MAP: Record<Emotion, Emotion> = {
  happy: "neutral",
  curious: "neutral",
  shy: "neutral",
  sad: "neutral",
  neutral: "neutral",
};

/**
 * 回复后轻微回归 neutral：
 * 强烈情绪先变为过渡态，过渡态再变为 neutral。
 */
export function decayEmotion(): void {
  const current = getEmotion();
  const next = DECAY_MAP[current];
  if (next !== current) {
    setEmotion(next);
    emotionLogger.log({
      userId: "dev",
      fromEmotion: current,
      toEmotion: next,
      trigger: "decay",
    });
  }
}

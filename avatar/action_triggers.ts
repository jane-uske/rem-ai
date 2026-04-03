import type { ActionCommand } from "./types";

export interface TriggerRule {
  keywords: string[];
  action: ActionCommand;
}

export const ACTION_TRIGGERS: TriggerRule[] = [
  {
    keywords: [
      "yes",
      "yeah",
      "yep",
      "absolutely",
      "definitely",
      "correct",
      "right",
      "agree",
      "i agree",
      "that's right",
      "that is right",
      "exactly",
      "sure",
      "certainly",
      "indeed",
    ],
    action: { action: "nod", intensity: 0.7, duration: 500 },
  },
  {
    keywords: [
      "no",
      "nope",
      "disagree",
      "wrong",
      "not really",
      "don't agree",
      "do not agree",
      "i disagree",
      "can't agree",
      "cannot agree",
      "not true",
      "incorrect",
      "negative",
    ],
    action: { action: "shake_head", intensity: 0.6, duration: 600 },
  },
  {
    keywords: [
      "hello",
      "hi there",
      "hey there",
      "good morning",
      "good afternoon",
      "good evening",
      "greetings",
      "welcome",
      "nice to meet",
    ],
    action: { action: "wave", intensity: 0.8, duration: 1000 },
  },
  {
    keywords: [
      "let me think",
      "thinking",
      "ponder",
      "hmm",
      "hmmm",
      "wonder if",
      "considering",
      "give me a moment",
    ],
    action: { action: "tilt_head", intensity: 0.5, duration: 800 },
  },
  {
    keywords: [
      "not sure",
      "unsure",
      "maybe",
      "unclear",
      "confused",
      "i'm not sure",
      "i am not sure",
      "uncertain",
      "perhaps",
      "hard to say",
    ],
    action: { action: "shrug", intensity: 0.5, duration: 700 },
  },
  {
    keywords: [
      "wow",
      "really?",
      "surprising",
      "surprised",
      "unexpected",
      "oh my",
      "astonishing",
      "incredible",
    ],
    action: { action: "eyebrow_raise", intensity: 0.9, duration: 400 },
  },
];

function normalizeText(text: string): string {
  return text.toLowerCase();
}

export function detectAction(text: string): ActionCommand | null {
  const hay = normalizeText(text);
  for (const rule of ACTION_TRIGGERS) {
    for (const kw of rule.keywords) {
      if (hay.includes(kw.toLowerCase())) {
        return rule.action;
      }
    }
  }
  return null;
}

export function detectActions(text: string): ActionCommand[] {
  const hay = normalizeText(text);
  const out: ActionCommand[] = [];
  for (const rule of ACTION_TRIGGERS) {
    for (const kw of rule.keywords) {
      if (hay.includes(kw.toLowerCase())) {
        out.push(rule.action);
        break;
      }
    }
  }
  return out;
}

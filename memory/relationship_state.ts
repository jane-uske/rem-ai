import type { MemoryRepository } from "./memory_repository";
import { createLogger } from "../infra/logger";

const logger = createLogger("relationship-state");

export const RELATIONSHIP_STATE_KEY = "__rem_relationship_state_v1";

export type PersistentRelationshipSentiment = "positive" | "neutral" | "negative";

export interface PersistentRelationshipTopicEntry {
  topic: string;
  depth: number;
  lastTurn: number;
  sentiment: PersistentRelationshipSentiment;
}

export interface PersistentRelationshipMoodSnapshot {
  turn: number;
  mood: string;
}

export interface PersistentSharedMoment {
  summary: string;
  topic: string;
  mood: string;
  hook: string;
  turn: number;
  createdAt: number;
}

export interface PersistentRelationshipStateV1 {
  version: "v1";
  updatedAt: number;
  userProfile: {
    interests: string[];
    personalityNotes: string[];
  };
  relationship: {
    familiarity: number;
    emotionalBond: number;
    turnCount: number;
    preferredTopics: string[];
  };
  topicHistory: PersistentRelationshipTopicEntry[];
  moodTrajectory: PersistentRelationshipMoodSnapshot[];
  conversationSummary: string;
  proactiveTopics: string[];
  sharedMoments: PersistentSharedMoment[];
}

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
    if (deduped.size >= limit) break;
  }
  return [...deduped];
}

function toTopicHistory(value: unknown): PersistentRelationshipTopicEntry[] {
  if (!Array.isArray(value)) return [];
  const topics: PersistentRelationshipTopicEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const topic = typeof record.topic === "string" ? record.topic.trim() : "";
    const depth = Math.max(1, Math.floor(toFiniteNumber(record.depth, 1)));
    const lastTurn = Math.max(0, Math.floor(toFiniteNumber(record.lastTurn, 0)));
    const sentiment = record.sentiment;
    if (!topic) continue;
    topics.push({
      topic,
      depth,
      lastTurn,
      sentiment:
        sentiment === "positive" || sentiment === "negative" ? sentiment : "neutral",
    });
    if (topics.length >= 24) break;
  }
  return topics;
}

function toMoodTrajectory(value: unknown): PersistentRelationshipMoodSnapshot[] {
  if (!Array.isArray(value)) return [];
  const moods: PersistentRelationshipMoodSnapshot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const mood = typeof record.mood === "string" ? record.mood.trim() : "";
    const turn = Math.max(0, Math.floor(toFiniteNumber(record.turn, 0)));
    if (!mood) continue;
    moods.push({ turn, mood });
    if (moods.length >= 24) break;
  }
  return moods;
}

function toSharedMoments(value: unknown): PersistentSharedMoment[] {
  if (!Array.isArray(value)) return [];
  const moments: PersistentSharedMoment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const summary =
      typeof record.summary === "string" ? record.summary.trim().slice(0, 180) : "";
    const topic =
      typeof record.topic === "string" ? record.topic.trim().slice(0, 40) : "";
    const mood =
      typeof record.mood === "string" ? record.mood.trim().slice(0, 24) : "";
    const hook =
      typeof record.hook === "string" ? record.hook.trim().slice(0, 80) : "";
    const turn = Math.max(0, Math.floor(toFiniteNumber(record.turn, 0)));
    const createdAt = Math.max(0, Math.floor(toFiniteNumber(record.createdAt, Date.now())));
    if (!summary) continue;
    moments.push({
      summary,
      topic,
      mood,
      hook,
      turn,
      createdAt,
    });
    if (moments.length >= 8) break;
  }
  return moments;
}

export function relationshipStateEnabled(): boolean {
  return parseBooleanFlag(process.env.REM_RELATIONSHIP_STATE_ENABLED, true);
}

export function isSystemMemoryKey(key: string): boolean {
  return key.trim().startsWith("__rem_");
}

export function normalizePersistentRelationshipState(
  value: unknown,
): PersistentRelationshipStateV1 | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const version = record.version;
  if (version !== "v1") return null;

  const userProfile =
    record.userProfile && typeof record.userProfile === "object"
      ? (record.userProfile as Record<string, unknown>)
      : {};
  const relationship =
    record.relationship && typeof record.relationship === "object"
      ? (record.relationship as Record<string, unknown>)
      : {};

  return {
    version: "v1",
    updatedAt: Math.max(0, Math.floor(toFiniteNumber(record.updatedAt, Date.now()))),
    userProfile: {
      interests: toStringList(userProfile.interests, 12),
      personalityNotes: toStringList(userProfile.personalityNotes, 6),
    },
    relationship: {
      familiarity: clamp01(toFiniteNumber(relationship.familiarity, 0)),
      emotionalBond: clamp01(toFiniteNumber(relationship.emotionalBond, 0)),
      turnCount: Math.max(0, Math.floor(toFiniteNumber(relationship.turnCount, 0))),
      preferredTopics: toStringList(relationship.preferredTopics, 8),
    },
    topicHistory: toTopicHistory(record.topicHistory),
    moodTrajectory: toMoodTrajectory(record.moodTrajectory),
    conversationSummary:
      typeof record.conversationSummary === "string"
        ? record.conversationSummary.trim().slice(0, 600)
        : "",
    proactiveTopics: toStringList(record.proactiveTopics, 6),
    sharedMoments: toSharedMoments(record.sharedMoments),
  };
}

export async function loadPersistentRelationshipState(
  repo: MemoryRepository,
): Promise<PersistentRelationshipStateV1 | null> {
  try {
    const entry = await repo.getByKey(RELATIONSHIP_STATE_KEY);
    if (!entry?.value) return null;
    const parsed = normalizePersistentRelationshipState(JSON.parse(entry.value));
    if (!parsed) {
      logger.warn("relationship state payload is invalid", {
        key: RELATIONSHIP_STATE_KEY,
      });
    }
    return parsed;
  } catch (err) {
    logger.warn("failed to load relationship state", {
      error: (err as Error).message,
    });
    return null;
  }
}

export async function savePersistentRelationshipState(
  repo: MemoryRepository,
  state: PersistentRelationshipStateV1,
): Promise<void> {
  await repo.upsert(RELATIONSHIP_STATE_KEY, JSON.stringify(state), 1);
}

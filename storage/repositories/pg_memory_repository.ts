import type { MemoryEntry, MemoryRepository } from "../../memory/memory_repository";
import {
  upsertMemory,
  getUserMemories,
  getMemoryByKey,
  touchMemory,
  deleteMemoryByKey,
} from "./memory_repository";
import { createLogger } from "../../infra/logger";

const logger = createLogger("pg-memory-repo");

export class PgMemoryRepository implements MemoryRepository {
  private readonly _userId: string;

  constructor(userId: string = "dev") {
    this._userId = userId;
  }

  get userId(): string {
    return this._userId;
  }

  async upsert(key: string, value: string, _importance?: number): Promise<void> {
    try {
      await upsertMemory(this._userId, key, value);
      logger.debug("[Memory] upserted", { key, value: value.slice(0, 50) });
    } catch (err) {
      logger.warn("[Memory] upsert failed", { key, error: err });
      throw err;
    }
  }

  async getAll(): Promise<MemoryEntry[]> {
    try {
      const rows = await getUserMemories(this._userId);
      return rows.map((m) => ({
        key: m.key,
        value: m.value,
        importance: m.importance,
        accessCount: 0,
        createdAt: m.created_at.getTime(),
        lastAccessedAt: m.last_accessed_at.getTime(),
      }));
    } catch (err) {
      logger.warn("[Memory] getAll failed", { error: err });
      throw err;
    }
  }

  async getByKey(key: string): Promise<MemoryEntry | null> {
    try {
      const row = await getMemoryByKey(this._userId, key);
      if (!row) return null;
      return {
        key: row.key,
        value: row.value,
        importance: row.importance,
        accessCount: 0,
        createdAt: row.created_at.getTime(),
        lastAccessedAt: row.last_accessed_at.getTime(),
      };
    } catch (err) {
      logger.warn("[Memory] getByKey failed", { key, error: err });
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await deleteMemoryByKey(this._userId, key);
      logger.debug("[Memory] deleted", { key });
    } catch (err) {
      logger.warn("[Memory] delete failed", { key, error: err });
      throw err;
    }
  }

  async touch(key: string): Promise<void> {
    try {
      const row = await getMemoryByKey(this._userId, key);
      if (row) {
        await touchMemory(row.id);
        logger.debug("[Memory] touched", { key });
      }
    } catch (err) {
      logger.warn("[Memory] touch failed", { key, error: err });
      throw err;
    }
  }

  async getStale(maxAge: number, minImportance: number): Promise<MemoryEntry[]> {
    try {
      const all = await this.getAll();
      const now = Date.now();
      return all.filter(
        (e) => now - e.lastAccessedAt > maxAge && e.importance < minImportance,
      );
    } catch (err) {
      logger.warn("[Memory] getStale failed", { error: err });
      throw err;
    }
  }
}

let pgRepoInstance: PgMemoryRepository | null = null;

export function getPgMemoryRepository(userId: string = "dev"): PgMemoryRepository {
  if (!pgRepoInstance || pgRepoInstance.userId !== userId) {
    pgRepoInstance = new PgMemoryRepository(userId);
  }
  return pgRepoInstance;
}

import type { MemoryEntry, MemoryRepository } from "../../memory/memory_repository";
import {
  upsertMemory,
  getUserMemories,
  touchMemory,
  deleteMemory,
} from "./memory_repository";
import { createLogger } from "../../infra/logger";

const logger = createLogger("pg-memory-repo");

/**
 * PostgreSQL-backed MemoryRepository implementation.
 * Wraps the storage/repositories/memory_repository.ts functions
 * to match the MemoryRepository interface.
 */
export class PgMemoryRepository implements MemoryRepository {
  private userId: string;

  constructor(userId: string = "dev") {
    this.userId = userId;
  }

  async upsert(key: string, value: string, importance?: number): Promise<void> {
    try {
      // Note: Our current pg schema doesn't support passing importance yet,
      // it defaults to 1.0. This is okay for now.
      await upsertMemory(this.userId, key, value);
      logger.debug("[Memory] upserted", { key, value: value.slice(0, 50) });
    } catch (err) {
      logger.warn("[Memory] upsert failed", { key, error: err });
      throw err;
    }
  }

  async getAll(): Promise<MemoryEntry[]> {
    try {
      const dbMemories = await getUserMemories(this.userId);
      return dbMemories.map((m) => ({
        key: m.key,
        value: m.value,
        importance: m.importance,
        accessCount: 0, // Not tracked in pg schema yet
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
      const all = await this.getAll();
      const found = all.find((m) => m.key === key);
      return found || null;
    } catch (err) {
      logger.warn("[Memory] getByKey failed", { key, error: err });
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const all = await this.getAll();
      const found = all.find((m) => m.key === key);
      if (found) {
        // Note: Our pg memory repo doesn't have delete by key, only by id.
        // This is a limitation - we'd need to add that function.
        // For now, just log a warning.
        logger.warn("[Memory] delete not fully implemented for pg");
      }
    } catch (err) {
      logger.warn("[Memory] delete failed", { key, error: err });
      throw err;
    }
  }

  async touch(key: string): Promise<void> {
    try {
      const all = await this.getAll();
      const found = all.find((m) => m.key === key);
      if (found) {
        // We need the DB id to touch - our current schema doesn't expose this
        // from getUserMemories(). For now, this is a no-op with a warning.
        logger.debug("[Memory] touch not fully implemented for pg", { key });
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
        (e) =>
          now - e.lastAccessedAt > maxAge && e.importance < minImportance,
      );
    } catch (err) {
      logger.warn("[Memory] getStale failed", { error: err });
      throw err;
    }
  }
}

let pgRepoInstance: PgMemoryRepository | null = null;

export function getPgMemoryRepository(userId: string = "dev"): PgMemoryRepository {
  if (!pgRepoInstance || pgRepoInstance["userId"] !== userId) {
    pgRepoInstance = new PgMemoryRepository(userId);
  }
  return pgRepoInstance;
}

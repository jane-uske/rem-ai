import {
  MemoryEntry,
  MemoryRepository,
} from "./memory_repository";

export interface Memory {
  key: string;
  value: string;
}

export class InMemoryRepository implements MemoryRepository {
  private entries: MemoryEntry[] = [];

  snapshotMemories(): Memory[] {
    return this.entries.map(({ key, value }) => ({ key, value }));
  }

  async upsert(key: string, value: string, importance?: number): Promise<void> {
    const now = Date.now();
    const existing = this.entries.find((e) => e.key === key);
    if (existing) {
      existing.value = value;
      existing.lastAccessedAt = now;
      if (importance !== undefined) {
        existing.importance = importance;
      }
    } else {
      this.entries.push({
        key,
        value,
        importance: importance ?? 0.5,
        accessCount: 0,
        createdAt: now,
        lastAccessedAt: now,
      });
    }
  }

  async getAll(): Promise<MemoryEntry[]> {
    return this.entries.map((e) => ({ ...e }));
  }

  async getByKey(key: string): Promise<MemoryEntry | null> {
    const found = this.entries.find((e) => e.key === key);
    return found ? { ...found } : null;
  }

  async delete(key: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.key !== key);
  }

  async touch(key: string): Promise<void> {
    const entry = this.entries.find((e) => e.key === key);
    if (entry) {
      entry.lastAccessedAt = Date.now();
    }
  }

  async getStale(maxAge: number, minImportance: number): Promise<MemoryEntry[]> {
    const now = Date.now();
    return this.entries
      .filter(
        (e) =>
          now - e.lastAccessedAt > maxAge && e.importance < minImportance,
      )
      .map((e) => ({ ...e }));
  }
}

let repository: MemoryRepository = new InMemoryRepository();

export function getMemoryRepository(): MemoryRepository {
  return repository;
}

export function addMemory(key: string, value: string): void {
  void repository.upsert(key, value);
}

export function getAllMemories(): Memory[] {
  if (repository instanceof InMemoryRepository) {
    return repository.snapshotMemories();
  }
  throw new Error(
    "getAllMemories() requires the default InMemoryRepository; use getMemoryRepository().getAll() for async stores.",
  );
}

export interface MemoryEntry {
  key: string;
  value: string;
  importance: number;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface MemoryRepository {
  upsert(key: string, value: string, importance?: number): Promise<void>;
  getAll(): Promise<MemoryEntry[]>;
  getByKey(key: string): Promise<MemoryEntry | null>;
  delete(key: string): Promise<void>;
  touch(key: string): Promise<void>;
  getStale(maxAge: number, minImportance: number): Promise<MemoryEntry[]>;
}

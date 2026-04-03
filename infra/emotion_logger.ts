export interface EmotionLogEntry {
  timestamp: number;
  userId: string;
  fromEmotion: string;
  toEmotion: string;
  trigger: string;
}

const MAX_ENTRIES = 1000;

export class EmotionLogger {
  private readonly buffer: EmotionLogEntry[] = [];

  log(entry: Omit<EmotionLogEntry, "timestamp">): void {
    const full: EmotionLogEntry = { ...entry, timestamp: Date.now() };
    if (this.buffer.length >= MAX_ENTRIES) {
      this.buffer.shift();
    }
    this.buffer.push(full);
  }

  getHistory(userId?: string, limit?: number): EmotionLogEntry[] {
    let rows =
      userId === undefined
        ? [...this.buffer]
        : this.buffer.filter((e) => e.userId === userId);
    if (limit !== undefined && limit >= 0) {
      rows = rows.slice(-limit);
    }
    return rows;
  }

  getStats(userId?: string): {
    total: number;
    distribution: Record<string, number>;
  } {
    const rows =
      userId === undefined
        ? this.buffer
        : this.buffer.filter((e) => e.userId === userId);
    const distribution: Record<string, number> = {};
    for (const e of rows) {
      distribution[e.toEmotion] = (distribution[e.toEmotion] ?? 0) + 1;
    }
    return { total: rows.length, distribution };
  }

  exportEntries(): EmotionLogEntry[] {
    return [...this.buffer];
  }
}

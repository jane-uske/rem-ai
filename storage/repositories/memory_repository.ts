import { query } from '../database';
import type { DbMemory } from '../types';

function parseEmbedding(val: unknown): number[] | null {
  if (val == null) {
    return null;
  }
  if (Array.isArray(val)) {
    return val as number[];
  }
  if (typeof val === 'string') {
    return JSON.parse(val) as number[];
  }
  return null;
}

function mapRow(row: Record<string, unknown>): DbMemory {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    key: row.key as string,
    value: row.value as string,
    importance: Number(row.importance),
    embedding: parseEmbedding(row.embedding),
    created_at: row.created_at as Date,
    last_accessed_at: row.last_accessed_at as Date,
  };
}

function embeddingToVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export async function upsertMemory(
  userId: string,
  key: string,
  value: string
): Promise<DbMemory> {
  try {
    const res = await query(
      `INSERT INTO memories (user_id, key, value, importance)
       VALUES ($1, $2, $3, 1.0)
       ON CONFLICT (user_id, key)
       DO UPDATE SET
         value = EXCLUDED.value,
         last_accessed_at = now()
       RETURNING id, user_id, key, value, importance, embedding, created_at, last_accessed_at`,
      [userId, key, value]
    );
    const row = res.rows[0] as Record<string, unknown>;
    return mapRow(row);
  } catch (e) {
    console.log('[Storage] upsertMemory failed:', e);
    throw e;
  }
}

export async function getUserMemories(userId: string): Promise<DbMemory[]> {
  try {
    const res = await query(
      `SELECT id, user_id, key, value, importance, embedding, created_at, last_accessed_at
       FROM memories
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
    return res.rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (e) {
    console.log('[Storage] getUserMemories failed:', e);
    throw e;
  }
}

export async function findSimilarMemories(
  userId: string,
  embedding: number[],
  topK?: number
): Promise<DbMemory[]> {
  const k = topK !== undefined && topK > 0 ? topK : 10;
  try {
    const vectorLiteral = embeddingToVectorLiteral(embedding);
    const res = await query(
      `SELECT id, user_id, key, value, importance, embedding, created_at, last_accessed_at
       FROM memories
       WHERE user_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [userId, vectorLiteral, k]
    );
    return res.rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (e) {
    console.log('[Storage] findSimilarMemories failed:', e);
    throw e;
  }
}

export async function getMemoryByKey(userId: string, key: string): Promise<DbMemory | null> {
  try {
    const res = await query(
      `SELECT id, user_id, key, value, importance, embedding, created_at, last_accessed_at
       FROM memories
       WHERE user_id = $1 AND key = $2
       LIMIT 1`,
      [userId, key]
    );
    if (res.rows.length === 0) return null;
    return mapRow(res.rows[0] as Record<string, unknown>);
  } catch (e) {
    console.log('[Storage] getMemoryByKey failed:', e);
    throw e;
  }
}

export async function deleteMemoryByKey(userId: string, key: string): Promise<void> {
  try {
    await query(`DELETE FROM memories WHERE user_id = $1 AND key = $2`, [userId, key]);
  } catch (e) {
    console.log('[Storage] deleteMemoryByKey failed:', e);
    throw e;
  }
}

export async function touchMemory(id: string): Promise<void> {
  try {
    await query(
      `UPDATE memories SET last_accessed_at = now() WHERE id = $1`,
      [id]
    );
  } catch (e) {
    console.log('[Storage] touchMemory failed:', e);
    throw e;
  }
}

export async function deleteMemory(id: string): Promise<void> {
  try {
    await query(`DELETE FROM memories WHERE id = $1`, [id]);
  } catch (e) {
    console.log('[Storage] deleteMemory failed:', e);
    throw e;
  }
}

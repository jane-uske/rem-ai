import { query } from '../database';
import type { DbSession } from '../types';

function mapRow(row: Record<string, unknown>): DbSession {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    started_at: row.started_at as Date,
    ended_at: (row.ended_at as Date | null) ?? null,
  };
}

export async function createSession(userId: string): Promise<DbSession> {
  try {
    const res = await query(
      `INSERT INTO sessions (user_id)
       VALUES ($1)
       RETURNING id, user_id, started_at, ended_at`,
      [userId]
    );
    const row = res.rows[0] as Record<string, unknown>;
    return mapRow(row);
  } catch (e) {
    console.log('[Storage] createSession failed:', e);
    throw e;
  }
}

export async function endSession(sessionId: string): Promise<void> {
  try {
    await query(
      `UPDATE sessions SET ended_at = now() WHERE id = $1`,
      [sessionId]
    );
  } catch (e) {
    console.log('[Storage] endSession failed:', e);
    throw e;
  }
}

export async function getSession(
  sessionId: string
): Promise<DbSession | null> {
  try {
    const res = await query(
      `SELECT id, user_id, started_at, ended_at FROM sessions WHERE id = $1`,
      [sessionId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRow(res.rows[0] as Record<string, unknown>);
  } catch (e) {
    console.log('[Storage] getSession failed:', e);
    throw e;
  }
}

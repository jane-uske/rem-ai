export type {
  DbUser,
  DbSession,
  DbMessage,
  DbMemory,
  StorageConfig,
} from './types';

export {
  initDatabase,
  getPool,
  query,
  closeDatabase,
  checkDatabaseHealth,
} from './database';

export type { QueryResult } from 'pg';

export {
  initRedis,
  getRedis,
  closeRedis,
  cacheGet,
  cacheSet,
  cacheDel,
} from './redis';

export { saveMessage, getSessionMessages } from './repositories/message_repository';

export {
  upsertMemory,
  getUserMemories,
  findSimilarMemories,
  touchMemory,
  deleteMemory,
} from './repositories/memory_repository';

export {
  createSession,
  endSession,
  getSession,
} from './repositories/session_repository';

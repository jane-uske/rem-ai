import Redis from 'ioredis';

let client: Redis | null = null;

export async function initRedis(url?: string): Promise<void> {
  const redisUrl = url ?? process.env.REDIS_URL;
  if (!redisUrl) {
    const err = new Error('REDIS_URL is not set');
    console.log('[Storage] initRedis failed:', err.message);
    throw err;
  }
  try {
    client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    await client.ping();
    console.log('[Storage] Redis client initialized');
  } catch (e) {
    if (client) {
      client.disconnect();
      client = null;
    }
    console.log('[Storage] initRedis failed:', e);
    throw e;
  }
}

export function getRedis(): Redis {
  if (!client) {
    throw new Error('Redis is not initialized; call initRedis first');
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.quit();
    console.log('[Storage] Redis connection closed');
  } catch (e) {
    console.log('[Storage] closeRedis error:', e);
    throw e;
  } finally {
    client = null;
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    const value = await getRedis().get(key);
    return value;
  } catch (e) {
    console.log('[Storage] cacheGet error:', e);
    throw e;
  }
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<void> {
  try {
    const r = getRedis();
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await r.set(key, value, 'EX', ttlSeconds);
    } else {
      await r.set(key, value);
    }
  } catch (e) {
    console.log('[Storage] cacheSet error:', e);
    throw e;
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await getRedis().del(key);
  } catch (e) {
    console.log('[Storage] cacheDel error:', e);
    throw e;
  }
}

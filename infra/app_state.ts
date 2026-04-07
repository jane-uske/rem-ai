let _dbReady = false;
let _redisReady = false;
let _memoryMode: "in-memory" | "postgres" = "in-memory";

export function isDbReady(): boolean {
  return _dbReady;
}

export function setDbReady(ready: boolean): void {
  _dbReady = ready;
}

export function isRedisReady(): boolean {
  return _redisReady;
}

export function setRedisReady(ready: boolean): void {
  _redisReady = ready;
}

export function getMemoryMode(): "in-memory" | "postgres" {
  return _memoryMode;
}

export function setMemoryMode(mode: "in-memory" | "postgres"): void {
  _memoryMode = mode;
}

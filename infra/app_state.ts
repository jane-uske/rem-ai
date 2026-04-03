let _dbReady = false;
let _redisReady = false;

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

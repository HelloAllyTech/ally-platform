/** An in-memory stand-in for the RedisService calls the bot page uses. */
export class FakeRedis {
  readonly values = new Map<string, string>();
  fail = false;

  private check(): void {
    if (this.fail) throw new Error('redis down');
  }

  async incrWithExpiry(key: string, windowSeconds: number) {
    this.check();
    const count = Number(this.values.get(key) ?? 0) + 1;
    this.values.set(key, String(count));
    return { count, ttlSeconds: windowSeconds };
  }

  async set(key: string, value: string) {
    this.check();
    this.values.set(key, value);
  }

  async get(key: string) {
    this.check();
    return this.values.get(key) ?? null;
  }

  async del(key: string) {
    this.check();
    this.values.delete(key);
  }

  async acquireLock(key: string) {
    this.check();
    if (this.values.has(key)) return false;
    this.values.set(key, '1');
    return true;
  }
}

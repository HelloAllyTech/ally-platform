import { BotPageRateLimitService } from '../bot-page-rate-limit.service';
import { FakeRedis } from './fake-redis';

describe('BotPageRateLimitService', () => {
  let redis: FakeRedis;
  let emit: jest.Mock;
  let limits: BotPageRateLimitService;

  beforeEach(() => {
    redis = new FakeRedis();
    emit = jest.fn();
    limits = new BotPageRateLimitService(redis as never, { emit } as never);
  });

  it('allows up to the hourly limit, then says how long to wait', async () => {
    const now = Date.UTC(2026, 10, 7, 10, 30);
    for (let i = 0; i < 3; i++) {
      expect((await limits.hourly('v:bot:visitor', 3, now)).allowed).toBe(true);
    }
    const over = await limits.hourly('v:bot:visitor', 3, now);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBe(30 * 60);
    // The next hour is a new window.
    expect(
      (await limits.hourly('v:bot:visitor', 3, now + 3_600_000)).allowed,
    ).toBe(true);
  });

  it('caps a bot’s day and alerts the team once', async () => {
    const day = new Date('2026-11-07T10:00:00Z');
    expect((await limits.dailyCap('bot', 2, day)).allowed).toBe(true);
    expect((await limits.dailyCap('bot', 2, day)).allowed).toBe(true);
    expect((await limits.dailyCap('bot', 2, day)).allowed).toBe(false);
    expect((await limits.dailyCap('bot', 2, day)).allowed).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe('exception');
    expect(emit.mock.calls[0][1].message).toContain('daily cap');
    expect(await limits.dailyCapReached('bot', 2, day)).toBe(true);
    expect(
      await limits.dailyCapReached('bot', 2, new Date('2026-11-08T00:00:01Z')),
    ).toBe(false);
  });

  it('fails open when Redis is down', async () => {
    redis.fail = true;
    expect((await limits.hourly('v', 1)).allowed).toBe(true);
    expect((await limits.dailyCap('bot', 1)).allowed).toBe(true);
    expect(await limits.dailyCapReached('bot', 1)).toBe(false);
  });
});

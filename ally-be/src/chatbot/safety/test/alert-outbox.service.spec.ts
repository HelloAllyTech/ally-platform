import { LoggerService } from '../../../logger/logger.service';
import {
  AlertOutboxService,
  OUTBOX_MAX_ATTEMPTS,
  OutboxRow,
  OutboxTerminalError,
  backoffMs,
} from '../alert-outbox.service';

interface Store {
  rows: (OutboxRow & { state: string; error?: string })[];
}

/**
 * A fake database shared by "instances". The claim statement is atomic here the way
 * FOR UPDATE SKIP LOCKED is in Postgres: it takes rows out of `pending` in one step.
 */
function fakeDb(store: Store) {
  return {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        const taken = store.rows
          .filter((r) => r.state === 'pending')
          .slice(0, Number(params[0]));
        taken.forEach((r) => {
          r.state = 'sending';
          r.attempts += 1;
        });
        return [taken.map((r) => ({ ...r })), taken.length];
      }
      const id = params[0] as string;
      const row = store.rows.find((r) => r.id === id);
      if (!row) return [];
      if (sql.includes("state = 'sent'")) row.state = 'sent';
      else if (sql.includes("state = 'pending'")) {
        row.state = 'pending';
        row.error = params[2] as string;
      } else if (sql.includes("state = 'failed'")) {
        row.state = 'failed';
        row.error = params[1] as string;
      }
      return [];
    }),
  };
}

const row = (id: string, over: Partial<OutboxRow> = {}) =>
  ({
    id,
    chatbot_id: 'bot',
    conversation_id: 'c1',
    kind: 'crisis_email',
    recipient: `${id}@x.test`,
    channel: 'email',
    payload: {},
    dedupe_key: null,
    attempts: 0,
    state: 'pending',
    ...over,
  }) as Store['rows'][number];

describe('AlertOutboxService', () => {
  beforeEach(() => {
    jest.spyOn(LoggerService.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('two instances do not double send', async () => {
    const store: Store = {
      rows: Array.from({ length: 10 }, (_, i) => row(`r${i}`)),
    };
    const a = new AlertOutboxService(fakeDb(store) as never);
    const b = new AlertOutboxService(fakeDb(store) as never);
    const sentTo: string[] = [];
    const send = async (r: OutboxRow) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      sentTo.push(r.id);
    };
    await Promise.all([
      a.drain(send, undefined, 6),
      b.drain(send, undefined, 6),
    ]);
    expect(sentTo).toHaveLength(10);
    expect(new Set(sentTo).size).toBe(10);
    expect(store.rows.every((r) => r.state === 'sent')).toBe(true);
  });

  it('a send that fails is retried, and never marked sent', async () => {
    const store: Store = { rows: [row('r1')] };
    const service = new AlertOutboxService(fakeDb(store) as never);
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('SES down'))
      .mockResolvedValueOnce(undefined);
    await expect(service.drain(send)).resolves.toEqual({
      sent: 0,
      retried: 1,
      failed: 0,
    });
    expect(store.rows[0]).toMatchObject({
      state: 'pending',
      error: 'SES down',
    });
    await expect(service.drain(send)).resolves.toEqual({
      sent: 1,
      retried: 0,
      failed: 0,
    });
    expect(store.rows[0].state).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last attempt and falls back once', async () => {
    const store: Store = {
      rows: [row('r1', { attempts: OUTBOX_MAX_ATTEMPTS - 1 })],
    };
    const service = new AlertOutboxService(fakeDb(store) as never);
    const fallback = jest.fn().mockResolvedValue(undefined);
    const out = await service.drain(async () => {
      throw new Error('still down');
    }, fallback);
    expect(out.failed).toBe(1);
    expect(store.rows[0]).toMatchObject({
      state: 'failed',
      error: 'still down',
    });
    expect(fallback).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1' }),
      'still down',
    );
  });

  it('a terminal error is not retried and raises no fallback', async () => {
    const store: Store = { rows: [row('r1', { channel: 'whatsapp' })] };
    const service = new AlertOutboxService(fakeDb(store) as never);
    const fallback = jest.fn();
    await service.drain(async () => {
      throw new OutboxTerminalError('skipped: window closed');
    }, fallback);
    expect(store.rows[0]).toMatchObject({
      state: 'failed',
      error: 'skipped: window closed',
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('backs off exponentially, capped at an hour', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([
      60_000, 120_000, 240_000, 480_000,
    ]);
    expect(backoffMs(20)).toBe(3_600_000);
  });

  it('enqueue reports a dropped duplicate', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'x' }])
      .mockResolvedValueOnce([]);
    const service = new AlertOutboxService({ query } as never);
    const input = {
      chatbotId: 'b',
      kind: 'k',
      recipient: 'r',
      channel: 'email' as const,
      dedupeKey: 'd',
    };
    await expect(service.enqueue(input)).resolves.toBe(true);
    await expect(service.enqueue(input)).resolves.toBe(false);
  });
});

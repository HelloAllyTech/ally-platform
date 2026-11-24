import { LoggerService } from '../../../logger/logger.service';
import { WaTemplateKind } from '../../../whatsapp/enum/whatsapp.enum';
import { CrisisBackfillService } from '../crisis-backfill.service';

interface Chat {
  id: string;
  chatbot_id: string;
  safety_at: Date | null;
  safety_first_at: Date | null;
  safety_level?: number | null;
  retain_until?: Date | null;
}

const at = (d: string) => new Date(d);

function harness(chats: Chat[], messages: Record<string, string[]>) {
  const writes: string[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM chatbot_conversations')) {
      return chats
        .filter((c) => c.id > String(params[0]))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, Number(params[1]))
        .map((c) => ({ ...c }));
    }
    if (sql.includes('FROM chatbot_messages')) {
      const ids = params[0] as string[];
      return ids.flatMap((id) =>
        (messages[id] ?? []).map((text, i) => ({
          conversation_id: id,
          text,
          language: null,
          at: at(`2026-03-0${i + 1}T10:00:00Z`),
        })),
      );
    }
    if (sql.includes('UPDATE chatbot_conversations')) {
      const chat = chats.find((c) => c.id === params[0])!;
      if (chat.safety_first_at) return [[], 0];
      chat.safety_first_at = params[1] as Date;
      chat.safety_level = chat.safety_level ?? 1;
      chat.retain_until = new Date('2027-03-01T00:00:00Z');
      writes.push(chat.id);
      return [[{ id: chat.id }], 1];
    }
    return [];
  });
  const replies = {
    match: jest.fn(async (text: string) =>
      /die|suicide/i.test(text)
        ? { template: { kind: WaTemplateKind.CRISIS } }
        : /hello/i.test(text)
          ? { template: { kind: WaTemplateKind.COMMAND } }
          : null,
    ),
  };
  const service = new CrisisBackfillService(
    { query } as never,
    replies as never,
    {} as never,
    { get: () => undefined } as never,
  );
  return { service, chats, writes, replies };
}

const base = (id: string, over: Partial<Chat> = {}): Chat => ({
  id,
  chatbot_id: 'bot',
  safety_at: null,
  safety_first_at: null,
  ...over,
});

describe('CrisisBackfillService', () => {
  beforeEach(() => {
    jest.spyOn(LoggerService.prototype, 'info').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  const data = () =>
    harness(
      [
        base('a1'),
        base('a2'),
        base('a3', { safety_at: at('2026-02-01T00:00:00Z') }),
        base('a4', { safety_first_at: at('2026-01-01T00:00:00Z') }),
        base('a5'),
      ],
      {
        a1: ['hello', 'I want to die'],
        a2: ['hello'],
        a3: ['no keyword here'],
        a4: ['I want to die'],
        a5: ['suicide'],
      },
    );

  it('flags what the keyword rules match, from the first matching message', async () => {
    const h = data();
    const report = await h.service.run({ batchSize: 2 });
    expect(report).toMatchObject({
      dryRun: false,
      scanned: 4,
      matched: 2,
      updated: 3,
      alreadyFlagged: 1,
      done: true,
    });
    // a1: the second message matched, so its time is the second message's.
    expect(h.chats[0].safety_first_at).toEqual(at('2026-03-02T10:00:00Z'));
    expect(h.chats[0].retain_until).not.toBeNull();
    // a3: no keyword match, but the older safety_at stands as its first flag.
    expect(h.chats[2].safety_first_at).toEqual(at('2026-02-01T00:00:00Z'));
    expect(h.chats[1].safety_first_at).toBeNull();
    // a4 was already flagged: never overwritten.
    expect(h.chats[3].safety_first_at).toEqual(at('2026-01-01T00:00:00Z'));
  });

  it('is idempotent: a second run writes nothing', async () => {
    const h = data();
    await h.service.run();
    const before = h.writes.length;
    const again = await h.service.run();
    expect(h.writes.length).toBe(before);
    expect(again).toMatchObject({ updated: 0, scanned: 1, done: true });
  });

  it('a dry run reports the counts and writes nothing', async () => {
    const h = data();
    const report = await h.service.run({ dryRun: true });
    expect(report).toMatchObject({ dryRun: true, matched: 2, updated: 0 });
    expect(h.writes).toEqual([]);
    expect(h.chats.filter((c) => c.safety_first_at)).toHaveLength(1);
  });

  it('stops after max batches and hands back a cursor to continue from', async () => {
    const h = data();
    const first = await h.service.run({ batchSize: 2, maxBatches: 1 });
    expect(first.done).toBe(false);
    expect(first.cursor).toBe('a2');
    const rest = await h.service.run({ batchSize: 2, cursor: first.cursor });
    expect(rest.done).toBe(true);
    expect(h.writes.sort()).toEqual(['a1', 'a3', 'a5']);
  });
});

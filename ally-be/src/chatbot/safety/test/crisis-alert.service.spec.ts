import { LoggerService } from '../../../logger/logger.service';
import { OutboxRow, OutboxTerminalError } from '../alert-outbox.service';
import { CrisisAlertService } from '../crisis-alert.service';
import { crisisOf } from '../crisis-flag';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';

const NOW = new Date('2026-11-20T10:00:00Z');
const BOT = { id: 'bot-1', name: 'Sunrise', settings: {} };

interface Over {
  first?: boolean;
  prevLevel?: number;
  level?: number;
  channel?: string;
  heldBy?: number | null;
  members?: string[];
  flagged?: Record<string, unknown>[];
  lastInbound?: Date | null;
  lastText?: string;
  taken?: boolean;
  config?: Record<string, string>;
}

function harness(over: Over = {}) {
  const query = jest.fn(async (sql: string): Promise<unknown> => {
    if (sql.includes('WITH prev AS'))
      return [
        {
          first: over.first ?? true,
          prev_level: over.prevLevel ?? 0,
          level: over.level ?? 1,
          channel: over.channel ?? 'whatsapp',
          handled_by_user_id: over.heldBy ?? null,
        },
      ];
    if (sql.includes('information_schema')) return [];
    if (sql.includes('FROM chatbot_members m'))
      return (over.members ?? ['owner@x.test']).map((email) => ({ email }));
    if (sql.includes('FROM chatbot_messages'))
      return [
        {
          at: over.lastInbound === undefined ? NOW : over.lastInbound,
          text: over.lastText ?? 'I feel hopeless',
          language: 'en',
        },
      ];
    if (
      sql.includes(
        'c.safety_first_at IS NOT NULL AND c.safety_taken_at IS NULL',
      )
    )
      return over.flagged ?? [];
    if (sql.includes('SELECT channel, handled_by_user_id, safety_taken_at'))
      return [
        {
          channel: over.channel ?? 'whatsapp',
          handled_by_user_id: over.heldBy ?? null,
          safety_taken_at: over.taken ? NOW : null,
        },
      ];
    return [];
  });
  const outbox = {
    enqueue: jest.fn().mockResolvedValue(true),
    drain: jest.fn().mockResolvedValue({ sent: 2, retried: 0, failed: 0 }),
  };
  const events = { publishInbox: jest.fn(), publishVisitor: jest.fn() };
  const emitter = {
    emitAsync: jest.fn().mockResolvedValue([{ messageId: 'm', sent: true }]),
  };
  const email = { sendHandoverAlert: jest.fn().mockResolvedValue(true) };
  const slack = { sendBlocks: jest.fn().mockResolvedValue({ ok: true }) };
  const conversations = {
    appendMessage: jest.fn().mockResolvedValue({ id: 'msg', createdAt: NOW }),
  };
  const settings = {
    getForChatbot: jest.fn().mockResolvedValue({ helplineNumbers: '' }),
  };
  const service = new CrisisAlertService(
    { query } as never,
    outbox as never,
    events as never,
    conversations as never,
    settings as never,
    emitter as never,
    email as never,
    slack as never,
    { adminBaseUrl: 'https://admin.example' } as never,
    { get: (k: string) => over.config?.[k] } as never,
  );
  service.drainDelayMs = null;
  return {
    service,
    query,
    outbox,
    events,
    emitter,
    email,
    slack,
    conversations,
    settings,
  };
}

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 'o1',
  chatbot_id: 'bot-1',
  conversation_id: 'c1',
  kind: 'crisis_holding',
  recipient: 'c1',
  channel: 'whatsapp',
  payload: { text: 'hello' },
  dedupe_key: null,
  attempts: 1,
  ...over,
});

describe('CrisisAlertService', () => {
  beforeEach(() => {
    jest.spyOn(LoggerService.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('flag', () => {
    it('queues an immediate email to every owner and responder on the first flag', async () => {
      const h = harness({ members: ['a@x.test', 'b@x.test'] });
      await h.service.flag(BOT, 'c1', { level: 1, path: 'keyword' }, NOW);
      const emails = h.outbox.enqueue.mock.calls
        .map((c) => c[0])
        .filter((i) => i.kind === 'crisis_email');
      expect(emails.map((i) => i.recipient)).toEqual(['a@x.test', 'b@x.test']);
      expect(emails[0].dedupeKey).toBe('crisis_email:c1:L1:a@x.test');
      expect(emails[0].payload.body).toContain(
        'chatbots?tab=inbox&conversation=c1&bot=bot-1',
      );
      // No message text in the alert.
      expect(JSON.stringify(emails[0].payload)).not.toMatch(/hopeless/);
    });

    it('sets the flag fields in one statement that never overwrites the first flag', async () => {
      const h = harness();
      await h.service.flag(BOT, 'c1', { level: 2, path: 'classifier' }, NOW);
      const sql = h.query.mock.calls.find((c) =>
        String(c[0]).includes('WITH prev AS'),
      )![0] as string;
      expect(sql).toContain(
        'safety_first_at = COALESCE(c.safety_first_at, now())',
      );
      expect(sql).toContain('GREATEST(prev.prev_level, $2)');
      expect(sql).toContain('retain_until = COALESCE(c.retain_until');
      expect(sql).toContain("'crisis'");
      expect(sql).toContain('safety_at = now()');
    });

    it('sends the holding message once: a repeat flag queues nothing', async () => {
      const h = harness();
      await h.service.flag(BOT, 'c1', { level: 1, path: 'keyword' }, NOW);
      const holding = h.outbox.enqueue.mock.calls
        .map((c) => c[0])
        .filter((i) => i.kind === 'crisis_holding');
      expect(holding).toHaveLength(1);
      expect(holding[0]).toMatchObject({
        dedupeKey: 'holding:c1',
        channel: 'whatsapp',
      });
      // TF1 round 2 (approved 25 Nov): the crisis reply just gave the numbers; not repeated.
      expect(holding[0].payload.text).toBe(
        'Someone from the team will see this and reply as soon as they can.',
      );
      expect(holding[0].notBefore.getTime()).toBeGreaterThan(NOW.getTime());

      const again = harness({ first: false, prevLevel: 1, level: 1 });
      await again.service.flag(BOT, 'c1', { level: 1, path: 'keyword' }, NOW);
      expect(again.outbox.enqueue).not.toHaveBeenCalled();
    });

    it('a rise to emergency alerts again, without a second holding message', async () => {
      const h = harness({ first: false, prevLevel: 1, level: 2 });
      await h.service.flag(BOT, 'c1', { level: 2, path: 'classifier' }, NOW);
      const kinds = h.outbox.enqueue.mock.calls.map((c) => c[0].kind);
      expect(kinds).toEqual(['crisis_email']);
      expect(h.outbox.enqueue.mock.calls[0][0].dedupeKey).toContain(':L2:');
    });

    it('does not send the holding message when a person already holds the chat', async () => {
      const h = harness({ heldBy: 7 });
      await h.service.flag(BOT, 'c1', { level: 1, path: 'keyword' }, NOW);
      expect(
        h.outbox.enqueue.mock.calls.some((c) => c[0].kind === 'crisis_holding'),
      ).toBe(false);
    });

    it('with nobody to email, goes to Ally staff on Slack: never zero recipients', async () => {
      const h = harness({ members: [] });
      await h.service.flag(BOT, 'c1', { level: 1, path: 'keyword' }, NOW);
      expect(
        h.outbox.enqueue.mock.calls
          .map((c) => c[0])
          .find((i) => i.kind === 'crisis_staff'),
      ).toMatchObject({
        channel: 'slack',
      });
    });

    it('puts the holding message in the person’s language with the builder’s numbers first', async () => {
      const h = harness({ lastText: 'mujhe bahut dar lag raha hai' });
      h.settings.getForChatbot.mockResolvedValue({
        helplineNumbers: '1800-000',
      });
      await h.service.flag(BOT, 'c1', { level: 1, path: 'keyword' }, NOW);
      const text = h.outbox.enqueue.mock.calls
        .map((c) => c[0])
        .find((i) => i.kind === 'crisis_holding').payload.text as string;
      expect(text).toBe(
        'Team ka koi vyakti ise dekhega aur jitni jaldi ho sake jawab dega.',
      );
    });
  });

  describe('the one-minute job', () => {
    const flagged = (over: Record<string, unknown> = {}) => ({
      id: 'c1',
      chatbot_id: 'bot-1',
      channel: 'whatsapp',
      safety_first_at: new Date('2026-11-20T09:45:00Z'),
      name: 'Sunrise',
      settings: {},
      ...over,
    });

    it('sends "no one is available" once the bot’s wait has passed, inside the window', async () => {
      const h = harness({
        flagged: [flagged()],
        lastInbound: new Date('2026-11-20T09:44:00Z'),
      });
      const out = await h.service.runMinuteJob(NOW);
      expect(out.noOneAvailable).toBe(1);
      const queued = h.outbox.enqueue.mock.calls
        .map((c) => c[0])
        .find((i) => i.kind === 'no_one_available');
      expect(queued).toMatchObject({
        dedupeKey: 'no_one:c1',
        channel: 'whatsapp',
      });
      expect(queued.payload.text).toContain('findahelpline.com');
    });

    it('waits the full time first (default 10 minutes)', async () => {
      const h = harness({
        flagged: [
          flagged({ safety_first_at: new Date('2026-11-20T09:55:00Z') }),
        ],
      });
      await expect(h.service.runMinuteJob(NOW)).resolves.toMatchObject({
        noOneAvailable: 0,
      });
    });

    it('uses the bot’s own wait', async () => {
      const h = harness({
        flagged: [
          flagged({
            safety_first_at: new Date('2026-11-20T09:55:00Z'),
            settings: { waitBeforeNoOneAvailableMinutes: 2 },
          }),
        ],
      });
      await expect(h.service.runMinuteJob(NOW)).resolves.toMatchObject({
        noOneAvailable: 1,
      });
    });

    it('window expired: sends nothing and leaves the dashboard flag', async () => {
      const h = harness({
        flagged: [flagged()],
        lastInbound: new Date('2026-11-19T08:00:00Z'),
      });
      await expect(h.service.runMinuteJob(NOW)).resolves.toMatchObject({
        noOneAvailable: 0,
      });
      expect(
        h.outbox.enqueue.mock.calls.some(
          (c) => c[0].kind === 'no_one_available',
        ),
      ).toBe(false);
    });

    it('a web chat needs no window', async () => {
      const h = harness({
        flagged: [flagged({ channel: 'web' })],
        lastInbound: new Date('2026-11-01T00:00:00Z'),
      });
      await expect(h.service.runMinuteJob(NOW)).resolves.toMatchObject({
        noOneAvailable: 1,
      });
    });

    it('raises a flag untaken past the limit to staff once', async () => {
      const h = harness({
        flagged: [{ id: 'c1', chatbot_id: 'bot-1', name: 'Sunrise' }],
      });
      const out = await h.service.runMinuteJob(NOW);
      expect(out.untaken).toBeGreaterThanOrEqual(1);
      expect(
        h.outbox.enqueue.mock.calls
          .map((c) => c[0])
          .find((i) => i.kind === 'untaken_staff'),
      ).toMatchObject({
        channel: 'slack',
        dedupeKey: 'untaken:c1',
      });
    });

    it('drains the outbox', async () => {
      const h = harness();
      await expect(h.service.runMinuteJob(NOW)).resolves.toMatchObject({
        drained: 2,
      });
    });

    it('kill switches: the job off does nothing; sending off leaves rows waiting', async () => {
      const off = harness({
        flagged: [flagged()],
        config: { ASSISTANT_CRISIS_JOB_ENABLED: 'false' },
      });
      await expect(off.service.runMinuteJob(NOW)).resolves.toEqual({
        drained: 0,
        noOneAvailable: 0,
        untaken: 0,
      });
      expect(off.outbox.drain).not.toHaveBeenCalled();
      const quiet = harness({
        config: { ASSISTANT_ALERT_SENDING_ENABLED: '0' },
      });
      await quiet.service.drainOutbox();
      expect(quiet.outbox.drain).not.toHaveBeenCalled();
    });
  });

  describe('sending one row', () => {
    it('an email the provider refuses is an error, so the row is retried', async () => {
      const h = harness();
      h.email.sendHandoverAlert.mockResolvedValue(false);
      await expect(
        h.service.send(
          row({
            channel: 'email',
            recipient: 'a@x.test',
            payload: { subject: 's', body: 'b' },
          }),
        ),
      ).rejects.toThrow(/did not accept/);
    });

    it('a WhatsApp message outside the window is a terminal skip', async () => {
      const h = harness({ lastInbound: new Date('2026-01-01T00:00:00Z') });
      await expect(h.service.send(row(), NOW)).rejects.toBeInstanceOf(
        OutboxTerminalError,
      );
      expect(h.emitter.emitAsync).not.toHaveBeenCalled();
    });

    it('sends on WhatsApp inside the window, as a hand-over message', async () => {
      const h = harness();
      await h.service.send(row(), NOW);
      expect(h.emitter.emitAsync).toHaveBeenCalledWith(
        'inbox.whatsapp.send',
        expect.objectContaining({
          conversationId: 'c1',
          text: 'hello',
          handledBy: WaHandledBy.HANDOVER,
        }),
      );
    });

    it('a WhatsApp send the provider refuses is retried', async () => {
      const h = harness();
      h.emitter.emitAsync.mockResolvedValue([{ messageId: '', sent: false }]);
      await expect(h.service.send(row(), NOW)).rejects.not.toBeInstanceOf(
        OutboxTerminalError,
      );
    });

    it('skips a chat a person has taken meanwhile', async () => {
      const h = harness({ taken: true });
      await expect(h.service.send(row(), NOW)).rejects.toBeInstanceOf(
        OutboxTerminalError,
      );
    });

    it('a web chat gets the message on its stream', async () => {
      const h = harness({ channel: 'web' });
      await h.service.send(row({ channel: 'web' }));
      expect(h.conversations.appendMessage).toHaveBeenCalled();
      expect(h.events.publishVisitor).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ text: 'hello' }),
      );
    });

    it('Slack not accepting is an error', async () => {
      const h = harness();
      h.slack.sendBlocks.mockResolvedValue({
        ok: false,
        error: 'channel_not_found',
      });
      await expect(
        h.service.send(row({ channel: 'slack', payload: { text: 't' } })),
      ).rejects.toThrow('channel_not_found');
    });
  });

  describe('crisisOf', () => {
    it('reads the level and path the engine set, never inferring them (stage 4)', () => {
      expect(
        crisisOf({ handledBy: WaHandledBy.TEMPLATE, body: '' } as never),
      ).toBeNull();
      expect(
        crisisOf({
          handledBy: WaHandledBy.CRISIS,
          crisis: { level: 1, path: 'keyword' },
        } as never),
      ).toEqual({ level: 1, path: 'keyword' });
      expect(
        crisisOf({
          handledBy: WaHandledBy.CRISIS,
          crisis: { level: 2, path: 'classifier' },
        } as never),
      ).toEqual({ level: 2, path: 'classifier' });
      // A template id or an alert's words are not read any more.
      expect(
        crisisOf({
          handledBy: WaHandledBy.CRISIS,
          templateId: 't',
          alert: { message: 'fired (a medical emergency)' },
        } as never),
      ).toEqual({ level: 1, path: 'classifier' });
    });
  });
});

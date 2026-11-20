// The real agent module needs MCP/GitHub/Google credentials when it builds its
// clients; the auditor only borrows three exports.
const mockMcpClient = { listTools: jest.fn() };
jest.mock('../new-analytical-agent.service', () => ({
  getLlm: () => ({}),
  AVAILABLE_TABLES: { 'proj.ds.table_a': 'a.yml', 'proj.ds.table_b': 'b.yml' },
  getMcpClient: () => mockMcpClient,
}));
jest.mock('langchain', () => ({
  createAgent: jest.fn(),
  toolStrategy: jest.fn((schema: unknown) => schema),
  HumanMessage: class {
    constructor(public content: string) {}
  },
}));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { createAgent } from 'langchain';
import { QueryFailedError } from 'typeorm';
import { AUDIT_AGENT_LIMITS } from '../../constants/analytics-agent.constants';
import {
  AnalyticsAuditAgentService,
  resolveMessageCount,
  selectAuditTools,
} from '../analytics-audit-agent.service';

const client = mockMcpClient;

const verdict = {
  verdict: 'correct',
  summary: 'Re-ran the count; it matches.',
  issues: [],
};

const row = (
  id: string,
  question: string,
  answer: unknown,
  sql = 'SELECT 1',
  createdAt = '2026-11-10T09:00:00.000Z',
  feedback: 'up' | 'down' | null = null,
) =>
  ({
    id,
    question,
    outcome: 'answer',
    createdAt: new Date(createdAt),
    response: { answer, sql },
    feedback,
  }) as never;

describe('resolveMessageCount', () => {
  it('defaults to 15 when nothing usable is given', () => {
    expect(resolveMessageCount()).toBe(15);
    expect(resolveMessageCount(Number.NaN)).toBe(15);
    expect(resolveMessageCount(Number.POSITIVE_INFINITY)).toBe(15);
  });

  it('forces a given count into 1..MAX', () => {
    expect(resolveMessageCount(0)).toBe(1);
    expect(resolveMessageCount(-4)).toBe(1);
    expect(resolveMessageCount(7.9)).toBe(7);
    expect(resolveMessageCount(10_000)).toBe(
      AUDIT_AGENT_LIMITS.MAX_MESSAGE_COUNT,
    );
  });
});

describe('selectAuditTools', () => {
  it('drops the write-capable execute_sql and keeps the read-only tools', () => {
    // Named as the MCP client names them: prefixed with the server.
    const names = [
      'bigQuery_execute_sql',
      'bigQuery_execute_sql_readonly',
      'bigQuery_get_table_info',
      'github_get_file_contents',
    ];
    const kept = selectAuditTools(names.map((name) => ({ name })) as never);
    expect(kept.map((t) => t.name)).toEqual([
      'bigQuery_execute_sql_readonly',
      'bigQuery_get_table_info',
      'github_get_file_contents',
    ]);
  });

  it('drops it under its bare name too, in case the client stops prefixing', () => {
    const kept = selectAuditTools(
      ['execute_sql', 'execute_sql_readonly'].map((name) => ({
        name,
      })) as never,
    );
    expect(kept.map((t) => t.name)).toEqual(['execute_sql_readonly']);
  });
});

describe('AnalyticsAuditAgentService', () => {
  const invoke = jest.fn();

  /**
   * `found` is what the messages repo returns (newest first, as queried).
   * `alreadyAudited` are ids a saved run holds a finished audit of.
   */
  const build = (
    found: unknown[],
    opts: {
      alreadyAudited?: string[];
      running?: boolean;
      /** Ids the scheduled run's "not yet audited" query returns. */
      unaudited?: string[];
    } = {},
  ) => {
    const messages = {
      find: jest.fn().mockResolvedValue(found),
      query: jest
        .fn()
        .mockResolvedValue((opts.unaudited ?? []).map((id) => ({ id }))),
    };
    const audits = {
      exists: jest.fn().mockResolvedValue(opts.running ?? false),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((data: object) => ({ ...data })),
      save: jest.fn(async (data: object) => ({ id: 'audit-1', ...data })),
      findOne: jest.fn(),
      findOneByOrFail: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      // Cast so the mock's signature includes the params argument it never reads.
      query: jest.fn(((sql: string) =>
        Promise.resolve(
          sql.includes('DISTINCT')
            ? (opts.alreadyAudited ?? []).map((messageId) => ({ messageId }))
            : [],
        )) as (sql: string, params?: unknown[]) => Promise<unknown[]>),
    };
    const service = new AnalyticsAuditAgentService(
      messages as never,
      audits as never,
    );

    /** Entries appended so far, as stored. */
    const appended = () =>
      audits.query.mock.calls
        .filter(([sql]) => String(sql).includes('UPDATE'))
        .map(([, params]) => JSON.parse((params as string[])[0])[0] as never);
    return { service, messages, audits, appended };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (client.listTools as jest.Mock).mockResolvedValue([
      { name: 'bigQuery_execute_sql' },
      { name: 'bigQuery_execute_sql_readonly' },
    ]);
    (createAgent as jest.Mock).mockReturnValue({ invoke });
    invoke.mockResolvedValue({ structuredResponse: verdict });
  });

  describe('startAudit', () => {
    it('starts nothing when there are no answered messages', async () => {
      const { service, audits } = build([]);

      await expect(service.startAudit()).resolves.toBeNull();

      expect(createAgent).not.toHaveBeenCalled();
      expect(audits.save).not.toHaveBeenCalled();
    });

    it('starts nothing when every recent message is already audited', async () => {
      const { service, audits } = build(
        [row('m2', 'Second?', 'Two.'), row('m1', 'First?', 'One.')],
        { alreadyAudited: ['m1', 'm2'] },
      );

      await expect(service.startAudit()).resolves.toBeNull();

      expect(client.listTools).not.toHaveBeenCalled();
      expect(audits.save).not.toHaveBeenCalled();
    });

    it('registers a running row with the progress denominator, then returns before the work ends', async () => {
      const { service, audits } = build([
        row('m2', 'Second?', 'Two.'),
        row('m1', 'First?', 'One.'),
      ]);
      // Never settles: proves startAudit does not wait for the audits.
      invoke.mockReturnValue(new Promise(() => undefined));

      const started = await service.startAudit();

      expect(audits.create).toHaveBeenCalledWith({
        ranAt: expect.any(Date),
        status: 'running',
        trigger: 'manual',
        totalMessages: 2,
        messages: [],
      });
      expect(started?.audit).toMatchObject({
        id: 'audit-1',
        status: 'running',
      });
    });

    it('audits the newest 15 answered messages by default', async () => {
      const { service, messages } = build([row('m1', 'Q?', 'A.')]);

      await (
        await service.startAudit()
      )?.done;

      expect(messages.find).toHaveBeenCalledWith({
        where: { outcome: 'answer' },
        order: { createdAt: 'DESC' },
        take: 15,
      });
    });

    it('appends each audited message as { question, answer, audit } and completes the run', async () => {
      const { service, audits, appended } = build([
        row('m2', 'Second?', 'Two.', 'SELECT 2', '2026-11-10T10:00:00.000Z'),
        row('m1', 'First?', 'One.', 'SELECT 1', '2026-11-10T09:00:00.000Z'),
      ]);

      await (
        await service.startAudit()
      )?.done;

      const entries = appended() as {
        messageId: string;
        askedAt: string;
        question: string;
        answer: string;
        audit: unknown;
      }[];
      expect(entries.map((e) => e.messageId).sort()).toEqual(['m1', 'm2']);
      expect(entries.find((e) => e.messageId === 'm1')).toEqual({
        messageId: 'm1',
        askedAt: '2026-11-10T09:00:00.000Z',
        question: 'First?',
        answer: 'One.',
        audit: verdict,
      });
      expect(audits.update).toHaveBeenLastCalledWith(
        { id: 'audit-1', status: 'running' },
        { status: 'completed' },
      );
    });

    it('shows the auditor the question, answer, SQL and when it was asked', async () => {
      const { service } = build([
        row('m1', 'How many?', 'Forty.', 'SELECT COUNT(*) FROM t'),
      ]);

      await (
        await service.startAudit()
      )?.done;

      const input = (
        invoke.mock.calls[0][0] as { messages: { content: string }[] }
      ).messages[0].content;
      expect(input).toContain('How many?');
      expect(input).toContain('Forty.');
      expect(input).toContain('SELECT COUNT(*) FROM t');
      expect(input).toContain('2026-11-10T09:00:00.000Z');
    });

    describe('what the asker thought of the answer', () => {
      const inputFor = async (
        feedback: 'up' | 'down' | null,
      ): Promise<string> => {
        const { service } = build([
          row(
            'm1',
            'How many?',
            'Forty.',
            'SELECT 1',
            '2026-11-10T09:00:00.000Z',
            feedback,
          ),
        ]);
        await (
          await service.startAudit()
        )?.done;
        return (invoke.mock.calls[0][0] as { messages: { content: string }[] })
          .messages[0].content;
      };

      it('tells the auditor about a thumbs down', async () => {
        const input = await inputFor('down');

        expect(input).toContain('<user_feedback>');
        expect(input).toContain('thumbs down');
      });

      it('tells the auditor about a thumbs up', async () => {
        const input = await inputFor('up');

        expect(input).toContain('<user_feedback>');
        expect(input).toContain('thumbs up');
      });

      it('leaves feedback out entirely when the asker gave none', async () => {
        const input = await inputFor(null);

        expect(input).not.toContain('user_feedback');
        expect(input).not.toContain('thumbs');
      });
    });

    it('keeps going and records the error when one audit fails, still completing the run', async () => {
      const { service, audits, appended } = build([
        row('m2', 'Second?', 'Two.'),
        row('m1', 'First?', 'One.'),
      ]);
      // m1 runs first (oldest first) and throws; m2 succeeds.
      invoke
        .mockRejectedValueOnce(new Error('recursion limit'))
        .mockResolvedValueOnce({ structuredResponse: verdict });

      await (
        await service.startAudit()
      )?.done;

      const entries = appended() as {
        messageId: string;
        audit: unknown;
        error?: string;
      }[];
      expect(entries.find((e) => e.messageId === 'm1')).toMatchObject({
        audit: null,
        error: 'recursion limit',
      });
      expect(entries.find((e) => e.messageId === 'm2')).toMatchObject({
        audit: verdict,
      });
      expect(audits.update).toHaveBeenLastCalledWith(
        { id: 'audit-1', status: 'running' },
        { status: 'completed' },
      );
    });

    it('records an error rather than a verdict when the agent returns no structured answer', async () => {
      const { service, appended } = build([row('m1', 'Q?', 'A.')]);
      invoke.mockResolvedValue({ structuredResponse: undefined });

      await (
        await service.startAudit()
      )?.done;

      const [entry] = appended() as { audit: unknown; error?: string }[];
      expect(entry.audit).toBeNull();
      expect(entry.error).toMatch(/without a valid verdict/);
    });

    it('marks the run failed, without rejecting, when saving progress breaks', async () => {
      const { service, audits } = build([row('m1', 'Q?', 'A.')]);
      audits.query.mockImplementation(async (sql: string) => {
        if (sql.includes('UPDATE')) throw new Error('db down');
        return [];
      });

      const started = await service.startAudit();
      await expect(started?.done).resolves.toBeUndefined();

      expect(audits.update).toHaveBeenLastCalledWith(
        { id: 'audit-1', status: 'running' },
        { status: 'failed' },
      );
    });

    it('treats a stored response with no answer text as an empty answer', async () => {
      const { service, appended } = build([row('m1', 'Q?', undefined)]);

      await (
        await service.startAudit()
      )?.done;

      expect((appended() as { answer: string }[])[0].answer).toBe('');
    });
  });

  describe('startScheduledAudit', () => {
    it('starts nothing when no answer is waiting for an audit', async () => {
      const { service, messages, audits } = build([], { unaudited: [] });

      await expect(service.startScheduledAudit()).resolves.toBeNull();

      expect(messages.find).not.toHaveBeenCalled();
      expect(createAgent).not.toHaveBeenCalled();
      expect(audits.save).not.toHaveBeenCalled();
    });

    it('audits every answer not yet audited, not just a fixed last-N, oldest first', async () => {
      const waiting = Array.from({ length: 20 }, (_, i) =>
        row(`m${i}`, `Question ${i}?`, `Answer ${i}`),
      );
      const { service, messages, audits, appended } = build(waiting, {
        unaudited: waiting.map((_, i) => `m${i}`),
      });

      const started = await service.startScheduledAudit();
      await started!.done;

      expect(audits.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalMessages: 20 }),
      );
      expect(appended()).toHaveLength(20);
      // The lookup asks for the oldest-first order the entries are read in.
      expect(messages.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC' } }),
      );
    });

    it('saves the run as scheduled, where a run started by hand is manual', async () => {
      const { service, audits } = build([row('m1', 'First?', 'One.')], {
        unaudited: ['m1'],
      });
      invoke.mockReturnValue(new Promise(() => undefined));

      await service.startScheduledAudit();

      expect(audits.create).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: 'scheduled' }),
      );
    });

    it('limits the lookup to the scheduled ceiling', async () => {
      const { service, messages } = build([], { unaudited: [] });

      await service.startScheduledAudit();

      expect(messages.query).toHaveBeenCalledWith(expect.any(String), [
        AUDIT_AGENT_LIMITS.SCHEDULED_MAX_MESSAGES,
      ]);
    });

    it('only counts finished audits as audited, so a failed one is retried', async () => {
      const { service, messages } = build([], { unaudited: [] });

      await service.startScheduledAudit();

      const sql = String(messages.query.mock.calls[0][0]);
      expect(sql).toContain("jsonb_typeof(entry->'audit') = 'object'");
      expect(sql).toContain(`m."outcome" = 'answer'`);
    });

    it('is refused with a 409, doing no work, while a run is in progress', async () => {
      const { service, messages } = build([], { running: true });

      await expect(service.startScheduledAudit()).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(messages.query).not.toHaveBeenCalled();
    });
  });

  describe('one run at a time', () => {
    it('refuses with a 409, and does no work, while a run is in progress', async () => {
      const { service, messages, audits } = build([row('m1', 'Q?', 'A.')], {
        running: true,
      });

      await expect(service.startAudit()).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(messages.find).not.toHaveBeenCalled();
      expect(audits.save).not.toHaveBeenCalled();
    });

    it('refuses with a 409 when another start wins the race to insert', async () => {
      const { service, audits } = build([row('m1', 'Q?', 'A.')]);
      audits.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], { code: '23505' } as never),
      );

      await expect(service.startAudit()).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('lets any other insert failure through as it is', async () => {
      const { service, audits } = build([row('m1', 'Q?', 'A.')]);
      audits.save.mockRejectedValue(new Error('connection reset'));

      await expect(service.startAudit()).rejects.toThrow('connection reset');
    });

    it('first marks runs that have been "running" for hours as failed, freeing the slot', async () => {
      const { service, audits } = build([]);

      await service.startAudit();

      expect(audits.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running' }),
        { status: 'failed' },
      );
    });

    it('leaves no running row behind when the tools cannot be reached', async () => {
      const { service, audits } = build([row('m1', 'Q?', 'A.')]);
      (client.listTools as jest.Mock).mockRejectedValue(new Error('mcp down'));

      await expect(service.startAudit()).rejects.toThrow('mcp down');

      expect(audits.save).not.toHaveBeenCalled();
    });
  });

  describe('already-audited messages', () => {
    it('skips a message an earlier run already audited', async () => {
      const { service, appended } = build(
        [row('m3', 'Third?', 'Three.'), row('m2', 'Second?', 'Two.')],
        { alreadyAudited: ['m2'] },
      );

      await (
        await service.startAudit()
      )?.done;

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(
        (appended() as { messageId: string }[]).map((e) => e.messageId),
      ).toEqual(['m3']);
    });

    it('looks up prior audits by the ids of the candidate messages only', async () => {
      const { service, audits } = build([
        row('m2', 'Second?', 'Two.'),
        row('m1', 'First?', 'One.'),
      ]);

      await (
        await service.startAudit()
      )?.done;

      const lookup = audits.query.mock.calls.find(([sql]) =>
        String(sql).includes('DISTINCT'),
      );
      expect(lookup?.[1]).toEqual([['m2', 'm1']]);
    });

    it('counts only finished audits, so a failed one is retried', async () => {
      const { service, audits } = build([row('m1', 'Q?', 'A.')]);

      await (
        await service.startAudit()
      )?.done;

      const lookup = audits.query.mock.calls.find(([sql]) =>
        String(sql).includes('DISTINCT'),
      );
      expect(lookup?.[0]).toContain(`jsonb_typeof(entry->'audit') = 'object'`);
    });
  });

  describe('tools', () => {
    it('connects only to BigQuery and GitHub, never the Datalyze server', async () => {
      const { service } = build([row('m1', 'Q?', 'A.')]);

      await (
        await service.startAudit()
      )?.done;

      expect(client.listTools).toHaveBeenCalledWith('bigQuery', 'github');
    });

    it('never gives the agent the write-capable execute_sql tool', async () => {
      const { service } = build([row('m1', 'Q?', 'A.')]);

      await (
        await service.startAudit()
      )?.done;

      const { tools } = (createAgent as jest.Mock).mock.calls[0][0] as {
        tools: { name: string }[];
      };
      expect(tools.map((t) => t.name)).toEqual([
        'bigQuery_execute_sql_readonly',
      ]);
    });
  });

  describe('runAudit', () => {
    it('waits for the run to end and returns the saved row', async () => {
      const { service, audits } = build([row('m1', 'Q?', 'A.')]);

      const saved = await service.runAudit();

      expect(audits.update).toHaveBeenLastCalledWith(
        { id: 'audit-1', status: 'running' },
        { status: 'completed' },
      );
      expect(saved).toEqual({ id: 'audit-1' });
    });

    it('returns null when there was nothing to audit', async () => {
      const { service } = build([]);

      await expect(service.runAudit()).resolves.toBeNull();
    });
  });

  describe('listRuns', () => {
    it('returns summaries, newest first as queried, with ISO dates', async () => {
      const { service, audits } = build([]);
      audits.query.mockResolvedValue([
        {
          id: 'a2',
          ranAt: new Date('2026-11-11T00:00:00.000Z'),
          status: 'running',
          trigger: 'scheduled',
          totalMessages: 5,
          completedMessages: 2,
          verdictCounts: { correct: 1, error: 1 },
        },
      ]);

      await expect(service.listRuns()).resolves.toEqual([
        {
          id: 'a2',
          ranAt: '2026-11-11T00:00:00.000Z',
          status: 'running',
          trigger: 'scheduled',
          totalMessages: 5,
          completedMessages: 2,
          verdictCounts: { correct: 1, error: 1 },
        },
      ]);
      expect(audits.query.mock.calls[0][1]).toEqual([
        AUDIT_AGENT_LIMITS.HISTORY_LIMIT,
      ]);
    });
  });

  describe('getRun', () => {
    it('is a 404 for an unknown run', async () => {
      const { service, audits } = build([]);
      audits.findOne.mockResolvedValue(null);

      await expect(service.getRun('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('puts entries back in the order the questions were asked and counts verdicts', async () => {
      const { service, audits } = build([]);
      // Stored in completion order, not asked order.
      audits.findOne.mockResolvedValue({
        id: 'a1',
        ranAt: new Date('2026-11-11T00:00:00.000Z'),
        status: 'completed',
        trigger: 'manual',
        totalMessages: 3,
        messages: [
          {
            messageId: 'late',
            askedAt: '2026-11-10T11:00:00.000Z',
            audit: null,
          },
          {
            messageId: 'early',
            askedAt: '2026-11-10T09:00:00.000Z',
            audit: { verdict: 'correct' },
          },
          {
            messageId: 'mid',
            askedAt: '2026-11-10T10:00:00.000Z',
            audit: { verdict: 'incorrect' },
          },
        ],
      });

      const run = await service.getRun('a1');

      expect(run.messages.map((m) => m.messageId)).toEqual([
        'early',
        'mid',
        'late',
      ]);
      expect(run).toMatchObject({
        trigger: 'manual',
        completedMessages: 3,
        totalMessages: 3,
        verdictCounts: { correct: 1, incorrect: 1, error: 1 },
      });
    });
  });
});

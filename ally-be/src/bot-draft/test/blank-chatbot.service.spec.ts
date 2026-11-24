import { ExecutionManager } from '../../common/execution/execution-manager';
import {
  BLANK_LIMITS,
  BlankChatbotService,
} from '../blank/blank-chatbot.service';

/**
 * Blank chatbots (stage 3). The SQL itself is exercised by the pg spec; here the decisions around
 * it: reuse rather than create, one blank per double click, the cleanup's re-check under a lock,
 * and the kill switch.
 */
function harness(
  opts: {
    existing?: { id: string; count: string }[];
    candidates?: { id: string; chatbot_id: string }[];
    /** Candidate ids still eligible when re-checked under the lock. */
    stillEligible?: string[];
    budgets?: boolean;
    budgetFor?: string[];
  } = {},
) {
  const deleted: string[] = [];
  const queries: string[] = [];
  const manager = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push(sql);
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('count(*) OVER ()')) return opts.existing ?? [];
      if (sql.includes('FOR UPDATE SKIP LOCKED')) return [{ id: params[0] }];
      if (sql.includes('SELECT 1 FROM (')) {
        return (opts.stillEligible ?? []).includes(String(params[2]))
          ? [{ '?column?': 1 }]
          : [];
      }
      if (sql.includes('FROM chatbot_budgets')) {
        return (opts.budgetFor ?? []).includes(String(params[0]))
          ? [{ '?column?': 1 }]
          : [];
      }
      if (sql.startsWith('DELETE FROM bot_drafts')) {
        deleted.push(`draft:${params[0]}`);
        return [];
      }
      if (sql.startsWith('DELETE FROM chatbots')) {
        deleted.push(`bot:${params[0]}`);
        return [];
      }
      return [];
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
      fn(manager),
    ),
    query: jest.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return [{ present: !!opts.budgets }];
      return opts.candidates ?? [];
    }),
  };
  let created = 0;
  const drafts = {
    create: jest.fn(async () => {
      created += 1;
      return { id: `new-${created}` };
    }),
    findById: jest.fn(async (id: string) => ({ id })),
  };
  const service = new BlankChatbotService(drafts as never, dataSource as never);
  return { service, drafts, deleted, queries, created: () => created };
}

describe('BlankChatbotService', () => {
  beforeEach(() => {
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('7' as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.BOT_DRAFT_BLANK_CLEANUP_ENABLED;
  });

  describe('create', () => {
    it('creates a blank when the builder has none', async () => {
      const h = harness();
      const { draft, reused } = await h.service.createOrReuse();
      expect(reused).toBe(false);
      expect(draft).toEqual({ id: 'new-1' });
      expect(h.drafts.create).toHaveBeenCalledWith(
        expect.objectContaining({ blank: true }),
      );
    });

    it('reuses the newest untouched blank: a double click makes one', async () => {
      const h = harness({ existing: [{ id: 'blank-1', count: '1' }] });
      const first = await h.service.createOrReuse();
      const second = await h.service.createOrReuse();
      expect(first).toEqual({ draft: { id: 'blank-1' }, reused: true });
      expect(second.draft).toEqual({ id: 'blank-1' });
      expect(h.drafts.create).not.toHaveBeenCalled();
    });

    it('serialises creates per builder with an advisory lock', async () => {
      const h = harness();
      await h.service.createOrReuse();
      expect(h.queries[0]).toContain('pg_advisory_xact_lock');
    });

    it('refuses past the cap when the newest blank could not be read', async () => {
      const h = harness({
        existing: [{ id: 'gone', count: String(BLANK_LIMITS.perBuilder) }],
      });
      h.drafts.findById.mockResolvedValueOnce(null as never);
      await expect(h.service.createOrReuse()).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'too_many_blanks' }),
      });
    });
  });

  describe('cleanup', () => {
    it('deletes an untouched blank past the age limit: the draft, then the chatbot', async () => {
      const h = harness({
        candidates: [{ id: 'd1', chatbot_id: 'b1' }],
        stillEligible: ['d1'],
      });
      expect(await h.service.cleanup()).toEqual({ deleted: 1 });
      expect(h.deleted).toEqual(['draft:d1', 'bot:b1']);
    });

    it('keeps a blank touched (or given a source) between the scan and the delete', async () => {
      const h = harness({
        candidates: [
          { id: 'd1', chatbot_id: 'b1' },
          { id: 'd2', chatbot_id: 'b2' },
        ],
        stillEligible: ['d2'],
      });
      expect(await h.service.cleanup()).toEqual({ deleted: 1 });
      expect(h.deleted).toEqual(['draft:d2', 'bot:b2']);
    });

    it('keeps a blank with a budget once budgets exist', async () => {
      const h = harness({
        candidates: [{ id: 'd1', chatbot_id: 'b1' }],
        stillEligible: ['d1'],
        budgets: true,
        budgetFor: ['b1'],
      });
      expect(await h.service.cleanup()).toEqual({ deleted: 0 });
      expect(h.deleted).toEqual([]);
    });

    it('can be switched off', async () => {
      process.env.BOT_DRAFT_BLANK_CLEANUP_ENABLED = 'false';
      const h = harness({
        candidates: [{ id: 'd1', chatbot_id: 'b1' }],
        stillEligible: ['d1'],
      });
      expect(await h.service.cleanup()).toEqual({ deleted: 0 });
    });

    it('never deletes ledger rows or library documents', async () => {
      const h = harness({
        candidates: [{ id: 'd1', chatbot_id: 'b1' }],
        stillEligible: ['d1'],
      });
      await h.service.cleanup();
      const deletes = h.queries.filter((q) => q.startsWith('DELETE'));
      expect(deletes.some((q) => /usage_events|kb_documents/.test(q))).toBe(
        false,
      );
    });
  });
});

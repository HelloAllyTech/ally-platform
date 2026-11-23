import {
  OWNER_CREDITS_TEXT,
  ownerCreditsText,
} from 'src/chatbot/engine/blocked-notice';
import { LedgerService, blockOnFeedOff } from '../service/ledger.service';

/**
 * "A feed that stops recording blocks new spend" applies where it protects real money: production,
 * or `ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF=true`. Locally a stopped feed (ally-ai with no usage
 * queue) warns once an hour and lets work go ahead. Paused work resumes, idempotently.
 */
describe('Credits: a stopped usage feed', () => {
  describe('blockOnFeedOff', () => {
    it('defaults on in production and off elsewhere', () => {
      expect(blockOnFeedOff({ NODE_ENV: 'production' })).toBe(true);
      expect(blockOnFeedOff({ NODE_ENV: 'development' })).toBe(false);
      expect(blockOnFeedOff({ NODE_ENV: 'test' })).toBe(false);
      expect(blockOnFeedOff({})).toBe(false);
    });

    it('the env var wins either way', () => {
      expect(
        blockOnFeedOff({
          NODE_ENV: 'development',
          ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF: 'true',
        }),
      ).toBe(true);
      expect(
        blockOnFeedOff({
          NODE_ENV: 'production',
          ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF: 'false',
        }),
      ).toBe(false);
    });
  });

  describe('feedBlocksSpend', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });
    const ledgerWithFeed = (healthy: boolean) => {
      const ledger = new LedgerService({} as never);
      jest.spyOn(ledger, 'feedHealthy').mockResolvedValue(healthy);
      const warn = jest.fn();
      (ledger as unknown as { logger: { warn: jest.Mock } }).logger = {
        warn,
        info: jest.fn(),
      } as never;
      return { ledger, warn };
    };

    it('local default: does not block, and warns once an hour', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF;
      const { ledger, warn } = ledgerWithFeed(false);
      const now = new Date('2026-11-23T10:00:00Z');
      expect(await ledger.feedBlocksSpend(now)).toBe(false);
      expect(
        await ledger.feedBlocksSpend(new Date(now.getTime() + 60_000)),
      ).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      await ledger.feedBlocksSpend(new Date(now.getTime() + 3_600_000));
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('production: blocks', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF;
      const { ledger } = ledgerWithFeed(false);
      expect(await ledger.feedBlocksSpend()).toBe(true);
    });

    it('a healthy feed never blocks', async () => {
      process.env.NODE_ENV = 'production';
      const { ledger } = ledgerWithFeed(true);
      expect(await ledger.feedBlocksSpend()).toBe(false);
    });
  });

  describe('resumeAllPaused', () => {
    const build = (rows: Array<Record<string, unknown>>, blocks = false) => {
      const query = jest.fn().mockResolvedValue(rows);
      const ledger = new LedgerService({ query } as never);
      jest.spyOn(ledger, 'feedBlocksSpend').mockResolvedValue(blocks);
      return { ledger, query };
    };

    it('re-runs every claimable paused job, then each sweep', async () => {
      const { ledger } = build([
        {
          kind: 'indexing',
          subject_id: 'doc-1',
          account_id: 'acct-1',
          owner_user_id: 2,
          payload: { documentId: 'doc-1', action: 'ingest' },
        },
      ]);
      const indexing = jest.fn().mockResolvedValue(undefined);
      const sweep = jest.fn().mockResolvedValue(3);
      ledger.registerResumer('indexing', indexing);
      ledger.registerSweeper('paused-documents', sweep);
      const result = await ledger.resumeAllPaused();
      expect(indexing).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: 'doc-1',
          payload: { documentId: 'doc-1', action: 'ingest' },
        }),
      );
      expect(sweep).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        jobs: 1,
        swept: { 'paused-documents': 3 },
        skipped: null,
      });
    });

    it('resumes nothing while a stopped feed still blocks (it would only pause again)', async () => {
      const { ledger, query } = build([], true);
      const sweep = jest.fn();
      ledger.registerResumer('indexing', jest.fn());
      ledger.registerSweeper('paused-documents', sweep);
      expect(await ledger.resumeAllPaused()).toEqual({
        jobs: 0,
        swept: {},
        skipped: 'feed_off',
      });
      expect(query).not.toHaveBeenCalled();
      expect(sweep).not.toHaveBeenCalled();
    });

    it('a failing sweep does not stop the others', async () => {
      const { ledger } = build([]);
      ledger.registerResumer('indexing', jest.fn());
      ledger.registerSweeper('a', jest.fn().mockRejectedValue(new Error('x')));
      ledger.registerSweeper('b', jest.fn().mockResolvedValue(1));
      expect((await ledger.resumeAllPaused()).swept).toEqual({ a: 0, b: 1 });
    });
  });
});

describe("the owner's test pane text", () => {
  it('names a stopped feed, never "contact Ally for more credits"', () => {
    expect(ownerCreditsText('feed_off')).toMatch(
      /usage tracking is temporarily unavailable/i,
    );
    expect(ownerCreditsText('feed_off')).not.toMatch(/contact ally/i);
    expect(ownerCreditsText('budget_empty')).toBe(OWNER_CREDITS_TEXT);
  });
});

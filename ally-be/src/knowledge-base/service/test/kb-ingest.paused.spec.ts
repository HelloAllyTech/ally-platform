import { KB_PAUSED_MESSAGES } from 'src/billing/util/credit-pause';
import { KbDocumentStatus } from '../../enum/knowledge-base.enum';
import { KB_PAUSED_SWEEP, KbIngestService } from '../kb-ingest.service';

/**
 * A document whose indexing the credits gate paused shows its real reason, and the resume sweep
 * runs again every document left at "Paused:" with no paused job.
 */
describe('KbIngestService: paused indexing', () => {
  const build = (reason: string) => {
    const repo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'doc-1',
        createdBy: 2,
        tags: [],
        rawText: 'text',
        updatedAt: new Date(0),
      }),
      update: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ id: 'doc-1' }, { id: 'doc-2' }]),
    };
    const limits = {
      onResume: jest.fn(),
      onSweep: jest.fn(),
      countOwnerRun: jest.fn().mockResolvedValue(true),
      backgroundGate: jest
        .fn()
        .mockResolvedValue({ ok: false, paused: true, reason }),
    };
    const service = new KbIngestService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      limits as never,
    );
    const inner = service as unknown as {
      extract: jest.Mock;
      chatbotUsing: jest.Mock;
      chunkAndIndex: jest.Mock;
    };
    inner.extract = jest
      .fn()
      .mockResolvedValue({ text: 'x', pages: [], sections: [] });
    inner.chatbotUsing = jest.fn().mockResolvedValue('bot-1');
    inner.chunkAndIndex = jest.fn();
    return { service, repo, limits, inner };
  };

  it('a stopped feed says usage tracking is unavailable, not out of credits', async () => {
    const { service, repo, inner } = build('feed_off');
    await service.run('doc-1', 'ingest');
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'doc-1' },
      {
        status: KbDocumentStatus.PENDING,
        statusMessage: KB_PAUSED_MESSAGES.feed_off,
      },
    );
    expect(KB_PAUSED_MESSAGES.feed_off).toMatch(/^Paused: usage tracking/);
    expect(KB_PAUSED_MESSAGES.feed_off).not.toMatch(/credits/i);
    expect(inner.chunkAndIndex).not.toHaveBeenCalled();
  });

  it('no billing account and an empty balance each get their own message', async () => {
    for (const [reason, message] of [
      ['no_payer', KB_PAUSED_MESSAGES.no_payer],
      ['free_balance_empty', KB_PAUSED_MESSAGES.out_of_credits],
    ] as const) {
      const { service, repo } = build(reason);
      await service.run('doc-1', 'ingest');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'doc-1' },
        expect.objectContaining({ statusMessage: message }),
      );
    }
  });

  it('registers a resume sweep that re-runs every paused document', async () => {
    const { service, repo, limits } = build('feed_off');
    expect(limits.onSweep).toHaveBeenCalledWith(
      KB_PAUSED_SWEEP,
      expect.any(Function),
    );
    const run = jest.spyOn(service, 'run').mockResolvedValue(undefined);
    expect(await service.resumePausedDocuments()).toBe(2);
    expect(repo.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['pending', 'Paused:%', 'indexing']),
    );
    expect(run).toHaveBeenCalledWith('doc-1', 'ingest');
    expect(run).toHaveBeenCalledWith('doc-2', 'ingest');
  });
});

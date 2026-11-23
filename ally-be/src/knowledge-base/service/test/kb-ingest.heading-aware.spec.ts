import { KbDocumentSourceType } from '../../enum/knowledge-base.enum';
import type { KbDocument } from '../../entity/kb-document.entity';
import { KbIngestService } from '../kb-ingest.service';

/**
 * Agents v2 chunk 20a-2: headings stay in their sections only for an onboarded assistant's own
 * pasted documents. v1 can answer for any bot, so every other document chunks as before.
 */
describe('KbIngestService: which documents keep headings in their sections', () => {
  const build = (safetyPack: string | null) => {
    const query = jest.fn().mockResolvedValue([{ safety_pack: safetyPack }]);
    const service = new KbIngestService(
      { manager: { query } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const headingAware = (doc: Partial<KbDocument>) =>
      (
        service as unknown as {
          headingAware: (d: Partial<KbDocument>) => Promise<boolean>;
        }
      ).headingAware(doc);
    return { headingAware, query };
  };

  const pasted = (over: Partial<KbDocument> = {}): Partial<KbDocument> => ({
    sourceType: KbDocumentSourceType.PASTE,
    tags: [],
    ownerChatbotId: null,
    ...over,
  });

  it('a crawled page (tagged onboarding)', async () => {
    const { headingAware, query } = build(null);
    expect(await headingAware(pasted({ tags: ['onboarding'] }))).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it("an onboarded assistant's own pasted document (its Owner notes)", async () => {
    expect(
      await build('mental_health').headingAware(
        pasted({ ownerChatbotId: 'bot-1' }),
      ),
    ).toBe(true);
  });

  it("not a bot's own document from before onboarding", async () => {
    expect(
      await build(null).headingAware(pasted({ ownerChatbotId: 'bot-1' })),
    ).toBe(false);
  });

  it('not a library document, nor any file', async () => {
    const { headingAware, query } = build('mental_health');
    expect(await headingAware(pasted())).toBe(false);
    expect(
      await headingAware(
        pasted({ sourceType: KbDocumentSourceType.PDF, tags: ['onboarding'] }),
      ),
    ).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('KbIngestService.run: a reindex extracts again only for heading-aware documents', () => {
  const build = (doc: Partial<KbDocument>) => {
    const service = new KbIngestService(
      {
        findOne: jest.fn().mockResolvedValue(doc),
        update: jest.fn(),
        manager: {
          query: jest.fn().mockResolvedValue([{ safety_pack: null }]),
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const inner = service as unknown as {
      extract: jest.Mock;
      chunkAndIndex: jest.Mock;
    };
    inner.extract = jest
      .fn()
      .mockResolvedValue({ text: 'x', pages: [], sections: [] });
    inner.chunkAndIndex = jest.fn().mockResolvedValue(undefined);
    return { service, inner };
  };

  it('an onboarding page is extracted again, then rechunked as a new version', async () => {
    const { service, inner } = build({
      id: 'd',
      sourceType: KbDocumentSourceType.PASTE,
      rawText: 'Heading\nText.',
      tags: ['onboarding'],
    });
    await service.run('d', 'reindex');
    expect(inner.extract).toHaveBeenCalled();
    expect(inner.chunkAndIndex.mock.calls[0][2]).toBe('reindex');
  });

  it('any other document rechunks its stored text, as before', async () => {
    const { service, inner } = build({
      id: 'd',
      sourceType: KbDocumentSourceType.PASTE,
      rawText: 'Heading\nText.',
      tags: [],
      ownerChatbotId: null,
    });
    await service.run('d', 'reindex');
    expect(inner.extract).not.toHaveBeenCalled();
    expect(inner.chunkAndIndex.mock.calls[0][1]).toEqual({
      text: 'Heading\nText.',
      pages: [],
      sections: [],
    });
  });
});

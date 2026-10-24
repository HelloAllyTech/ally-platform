import {
  KbCorpus,
  KbDocumentScope,
  KbRetrievalConsumer,
} from 'src/knowledge-base/enum/knowledge-base.enum';
import {
  GUIDE_LIBRARY_DEFAULT_LIMIT,
  GUIDE_LIBRARY_MAX_LIMIT,
  GuideLibraryService,
} from '../guide-library.service';

const TENANT_A = '11111111-1111-4111-8111-111111111111';

describe('GuideLibraryService.search', () => {
  let knowledgeBase: { searchForAudience: jest.Mock };
  let service: GuideLibraryService;

  beforeEach(() => {
    knowledgeBase = {
      searchForAudience: jest.fn().mockResolvedValue({
        passages: [
          {
            document_id: 'g',
            document_title: 'Self-care for helpers',
            text: 'Rest is part of the work.',
            similarity: 0.71,
            scope: KbDocumentScope.GLOBAL,
          },
          {
            document_id: 'a',
            document_title: 'Our escalation protocol',
            text: 'Call the duty supervisor.',
            similarity: 0.66,
            scope: KbDocumentScope.ORGANISATION,
          },
        ],
      }),
    };
    service = new GuideLibraryService(knowledgeBase as any);
  });

  it("searches the library for the learner's organisation, through the audience path", async () => {
    const hits = await service.search({
      query: 'who do I call',
      tenantId: TENANT_A,
      threadId: 'thread-1',
      userId: 7,
    });

    expect(knowledgeBase.searchForAudience).toHaveBeenCalledWith(
      {
        corpus: KbCorpus.ALLY_GUIDE_LIBRARY,
        query: 'who do I call',
        limit: GUIDE_LIBRARY_DEFAULT_LIMIT,
      },
      { tenantId: TENANT_A },
      {
        consumer: KbRetrievalConsumer.ALLY_GUIDE,
        sessionId: 'thread-1',
        userId: 7,
      },
    );
    expect(hits).toEqual([
      {
        documentId: 'g',
        title: 'Self-care for helpers',
        text: 'Rest is part of the work.',
        similarity: 0.71,
        scope: 'global',
      },
      {
        documentId: 'a',
        title: 'Our escalation protocol',
        text: 'Call the duty supervisor.',
        similarity: 0.66,
        scope: 'organisation',
      },
    ]);
  });

  it('passes an anonymous visitor through as null, which reaches global documents only', async () => {
    await service.search({ query: 'what is active listening', tenantId: null });

    expect(knowledgeBase.searchForAudience.mock.calls[0][1]).toEqual({
      tenantId: null,
    });
  });

  it('clamps the limit', async () => {
    await service.search({ query: 'q', tenantId: null, limit: 50 });
    await service.search({ query: 'q', tenantId: null, limit: 0 });

    expect(knowledgeBase.searchForAudience.mock.calls[0][0].limit).toBe(
      GUIDE_LIBRARY_MAX_LIMIT,
    );
    expect(knowledgeBase.searchForAudience.mock.calls[1][0].limit).toBe(1);
  });

  it('returns nothing for a blank query without searching', async () => {
    expect(await service.search({ query: '   ', tenantId: TENANT_A })).toEqual(
      [],
    );
    expect(knowledgeBase.searchForAudience).not.toHaveBeenCalled();
  });

  it('lets a library failure reach the caller, so "unavailable" is not read as "nothing found"', async () => {
    knowledgeBase.searchForAudience.mockRejectedValue(new Error('ally-ai 503'));

    await expect(
      service.search({ query: 'q', tenantId: TENANT_A }),
    ).rejects.toThrow('ally-ai 503');
  });
});

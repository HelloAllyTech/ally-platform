import {
  ClCollectionId,
  ClUseCase,
} from 'src/context-library/enum/context-library.enum';
import {
  GUIDE_LIBRARY_DEFAULT_LIMIT,
  GUIDE_LIBRARY_MAX_LIMIT,
  GuideLibraryService,
} from '../guide-library.service';

const TENANT_A = '11111111-1111-4111-8111-111111111111';

const result = (over: Record<string, unknown>, score = 0.03) => ({
  chunk: {
    code: 'AG-0001',
    statement: 'Rest is part of the work',
    body: null,
    attributes: {},
    citation: null,
    isGlobal: true,
    ...over,
  },
  band: 'good',
  score,
  card: '',
});

describe('GuideLibraryService.search', () => {
  let retrieval: { search: jest.Mock };
  let service: GuideLibraryService;

  beforeEach(() => {
    retrieval = {
      search: jest.fn().mockResolvedValue({
        retrievalId: 'r1',
        noConfidentMatch: false,
        block: '',
        results: [
          result({
            code: 'AG-0007',
            body: 'Rest is part of the work, not a reward for it.',
            citation: { title: 'Self-care for helpers', sectionPath: 'Rest' },
          }),
          result(
            {
              code: 'AG-0012',
              statement: 'Who to call when a learner is at risk',
              body: 'Call the duty supervisor first, then write it down.',
              citation: { title: 'Our escalation protocol' },
              isGlobal: false,
            },
            0.02,
          ),
        ],
      }),
    };
    service = new GuideLibraryService(retrieval as any);
  });

  it("searches the Ally Guide Library for the learner's organisation, through the ally_guide use case", async () => {
    const hits = await service.search({
      query: 'who do I call',
      tenantId: TENANT_A,
      threadId: 'thread-1',
      userId: 7,
    });

    expect(retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({
        useCase: ClUseCase.ALLY_GUIDE,
        audience: { tenantId: TENANT_A },
        collections: [ClCollectionId.ALLY_GUIDE_LIBRARY],
        queries: ['who do I call'],
        limit: GUIDE_LIBRARY_DEFAULT_LIMIT,
        sessionId: 'thread-1',
      }),
    );
    // The passage word for word, cited by the document it came from.
    expect(hits).toEqual([
      {
        code: 'AG-0007',
        title: 'Self-care for helpers',
        text: 'Rest is part of the work, not a reward for it.',
        score: 0.03,
        scope: 'global',
      },
      {
        code: 'AG-0012',
        title: 'Our escalation protocol',
        text: 'Call the duty supervisor first, then write it down.',
        score: 0.02,
        scope: 'organisation',
      },
    ]);
  });

  it('passes an anonymous visitor through as null, which reaches global entries only', async () => {
    await service.search({ query: 'what is active listening', tenantId: null });

    expect(retrieval.search.mock.calls[0][0].audience).toEqual({
      tenantId: null,
    });
  });

  it('falls back to what a distilled entry says, and to its statement, when there is no passage', async () => {
    retrieval.search.mockResolvedValue({
      noConfidentMatch: false,
      results: [
        result({ attributes: { detail: 'Name the feeling, then pause.' } }),
      ],
    });
    const [hit] = await service.search({ query: 'q', tenantId: null });
    expect(hit).toMatchObject({
      title: 'Rest is part of the work',
      text: 'Name the feeling, then pause.',
    });
  });

  it('reads "no confident match" as nothing found, never as a weak passage to stretch', async () => {
    retrieval.search.mockResolvedValue({
      noConfidentMatch: true,
      results: [result({ body: 'Something only loosely related.' })],
    });
    expect(await service.search({ query: 'q', tenantId: TENANT_A })).toEqual(
      [],
    );
  });

  it('clamps the limit', async () => {
    await service.search({ query: 'q', tenantId: null, limit: 50 });
    await service.search({ query: 'q', tenantId: null, limit: 0 });

    expect(retrieval.search.mock.calls[0][0].limit).toBe(
      GUIDE_LIBRARY_MAX_LIMIT,
    );
    expect(retrieval.search.mock.calls[1][0].limit).toBe(1);
  });

  it('returns nothing for a blank query without searching', async () => {
    expect(await service.search({ query: '   ', tenantId: TENANT_A })).toEqual(
      [],
    );
    expect(retrieval.search).not.toHaveBeenCalled();
  });

  it('lets a library failure reach the caller, so "unavailable" is not read as "nothing found"', async () => {
    retrieval.search.mockRejectedValue(
      new Error(
        'Retrieval failed — this says nothing about what the library holds.',
      ),
    );

    await expect(
      service.search({ query: 'q', tenantId: TENANT_A }),
    ).rejects.toThrow('Retrieval failed');
  });
});

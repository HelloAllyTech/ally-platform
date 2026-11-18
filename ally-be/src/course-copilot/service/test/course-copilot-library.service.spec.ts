import { Case } from 'src/case/entity/case.entity';
import { Competency } from 'src/learn/entity/competency.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioCharacter } from 'src/scenario-character/entity/scenario-character.entity';
import { TrackComponentTemplate } from 'src/track/entity/track-component-template.entity';
import {
  ClCollectionId,
  ClUseCase,
} from 'src/context-library/enum/context-library.enum';
import { CourseCopilotLibraryService } from '../course-copilot-library.service';

const CASE_ID = '6f1c2a8e-1f6b-4f7a-9a43-2b4d8c1e0a11';
const CHARACTER_OWN = '0b7e5f2a-3c4d-4e5f-8a9b-1c2d3e4f5a6b';
const CHARACTER_ALLY = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const chunk = (id: string, syncKey: string) => ({
  id,
  code: `CC-${id.padStart(4, '0')}`,
  collectionId: ClCollectionId.CONTENT_CATALOGUE as string,
  syncKey,
});

describe('CourseCopilotLibraryService — search_library on the Content Catalogue', () => {
  let repos: Map<unknown, { find: jest.Mock }>;
  let retrieval: { search: jest.Mock };
  let contentAccess: { ownerFilterFor: jest.Mock };
  let characterAccess: { resolveScope: jest.Mock };
  let service: CourseCopilotLibraryService;

  beforeEach(() => {
    repos = new Map<unknown, { find: jest.Mock }>([
      [Scenarios, { find: jest.fn().mockResolvedValue([]) }],
      [Case, { find: jest.fn().mockResolvedValue([]) }],
      [ScenarioCharacter, { find: jest.fn().mockResolvedValue([]) }],
      [TrackComponentTemplate, { find: jest.fn().mockResolvedValue([]) }],
      [
        Competency,
        {
          find: jest
            .fn()
            .mockResolvedValue([{ id: 'c-1', name: 'Active listening' }]),
        },
      ],
    ]);
    retrieval = { search: jest.fn() };
    contentAccess = { ownerFilterFor: jest.fn().mockResolvedValue(null) };
    characterAccess = {
      resolveScope: jest.fn().mockResolvedValue({
        isPlatform: false,
        tenantId: 'org-1',
        restrictedToTenantIds: null,
      }),
    };
    service = new CourseCopilotLibraryService(
      { getRepository: (entity: unknown) => repos.get(entity) } as any,
      {} as any,
      {} as any,
      characterAccess as any,
      contentAccess as any,
      retrieval as any,
    );
  });

  /** Runs the request's access check over `candidates`, as the pipeline does at hydration. */
  const pipeline = (candidates: ReturnType<typeof chunk>[]) =>
    retrieval.search.mockImplementation(async (req) => {
      const open: Set<string> = await req.canOpen(candidates);
      return {
        results: candidates
          .filter((c) => open.has(c.id))
          .map((c) => ({ chunk: c, band: 'good', score: 1 })),
        noConfidentMatch: false,
      };
    });

  it('searches as Course Copilot, for the trainer’s organisation, in the kind asked for', async () => {
    pipeline([]);
    await service.search('roleplay', 'grief at work', ['c-1'], 5, {
      sessionId: 'sess-1',
      tenantId: 'org-1',
    });
    expect(retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({
        useCase: ClUseCase.COURSE_COPILOT,
        audience: { tenantId: 'org-1' },
        collections: [ClCollectionId.CONTENT_CATALOGUE],
        queries: ['grief at work', 'Active listening'],
        facets: { itemKind: 'roleplay' },
        strict: true,
        facetScope: { key: 'itemKind', values: ['roleplay'] },
        limit: 5,
        sessionId: 'sess-1',
      }),
    );
  });

  it('a platform admin searches Ally’s own content (no organisation)', async () => {
    pipeline([]);
    await service.search('case', '', undefined, 99);
    const req = retrieval.search.mock.calls[0][0];
    expect(req.audience).toEqual({ tenantId: null });
    expect(req.queries).toEqual(['case']);
    expect(req.limit).toBe(20);
  });

  it('shows a roleplay only while it is published and in the trainer’s view, built from its row', async () => {
    contentAccess.ownerFilterFor.mockResolvedValue(7);
    repos.get(Scenarios)!.find.mockResolvedValue([
      {
        id: 42,
        title: 'Grief at work',
        description: '<p>A colleague asks for help</p>',
        competencyId: 'c-1',
        competencyIds: ['c-1'],
        difficultyLevel: 'MEDIUM',
        metadata: { languageVoices: { en: 'v1' } },
      },
    ]);
    pipeline([chunk('1', 'scenarios:42'), chunk('2', 'scenarios:43')]);

    const { hits } = await service.search('roleplay', 'grief', undefined);

    const where = repos.get(Scenarios)!.find.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'ACTIVE', createdBy: 7 });
    expect(hits).toEqual([
      {
        kind: 'roleplay',
        id: 42,
        code: 'CC-0001',
        title: 'Grief at work',
        description: 'A colleague asks for help',
        competencies: ['Active listening'],
        difficulty: 'MEDIUM',
        languages: ['en'],
      },
    ]);
  });

  it('holds cases to the trainer’s view too', async () => {
    contentAccess.ownerFilterFor.mockResolvedValue(7);
    repos.get(Case)!.find.mockResolvedValue([]);
    pipeline([chunk('3', `cases:${CASE_ID}`)]);
    const { hits } = await service.search('case', 'triage', undefined);
    expect(repos.get(Case)!.find.mock.calls[0][0].where).toMatchObject({
      status: 'ACTIVE',
      createdBy: 7,
    });
    expect(hits).toEqual([]);
  });

  it('shows an organisation’s admin only their own characters, never Ally’s', async () => {
    repos.get(ScenarioCharacter)!.find.mockResolvedValue([
      {
        id: CHARACTER_OWN,
        name: 'Asha',
        tenantId: 'org-1',
        voices: { 1: 'v' },
      },
      { id: CHARACTER_ALLY, name: 'Ravi', tenantId: null, voices: {} },
    ]);
    pipeline([
      chunk('4', `scenario_characters:${CHARACTER_OWN}`),
      chunk('5', `scenario_characters:${CHARACTER_ALLY}`),
    ]);
    const { hits } = await service.search('character', 'a teacher', undefined);
    expect(hits.map((h) => h.title)).toEqual(['Asha']);
    expect(hits[0].extra).toEqual({ hasVoices: true });
  });

  it('shows no character outside a request, rather than failing the search', async () => {
    characterAccess.resolveScope.mockRejectedValue(new Error('no user'));
    pipeline([chunk('4', `scenario_characters:${CHARACTER_OWN}`)]);
    const { hits } = await service.search('character', 'a teacher', undefined);
    expect(hits).toEqual([]);
  });

  it('drops anything that is not a catalogue item it can hydrate', async () => {
    pipeline([
      { ...chunk('6', 'scenarios:42'), collectionId: 'first_principles' },
      chunk('7', 'kb_document_chunks:1'),
    ]);
    const { hits } = await service.search('roleplay', 'grief', undefined);
    expect(hits).toEqual([]);
    expect(repos.get(Scenarios)!.find).not.toHaveBeenCalled();
  });

  it('lets a failed search throw, so the tool can say the library was unavailable', async () => {
    retrieval.search.mockRejectedValue(new Error('Retrieval failed'));
    await expect(
      service.search('roleplay', 'grief', undefined),
    ).rejects.toThrow('Retrieval failed');
  });
});

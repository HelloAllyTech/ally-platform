import { RoleplayInterviewToolsService } from '../roleplay-interview-tools.service';
import { RoleplayInterviewStatus } from '../../type/roleplay-interview.type';
import { COMPLETE_BRIEF, PLAN_INPUT } from './roleplay-interview-fixtures';

describe('RoleplayInterviewToolsService', () => {
  let update: jest.Mock;
  let library: Record<string, jest.Mock>;
  let fitCheck: { suggest: jest.Mock };
  let service: RoleplayInterviewToolsService;

  const context = (session: Record<string, any> = {}) => ({
    session: {
      id: 's-1',
      tenantId: 't-1',
      status: RoleplayInterviewStatus.INTERVIEWING,
      brief: {},
      plan: null,
      planVersion: 0,
      ...session,
    } as any,
    userId: 7,
    changes: {
      briefFields: new Set<string>(),
      planVersion: null as number | null,
    },
  });

  beforeEach(() => {
    update = jest.fn().mockResolvedValue(undefined);
    library = {
      competencyNames: jest
        .fn()
        .mockImplementation(
          async (ids: string[]) =>
            new Map(
              ids
                .filter((id) => id === '11111111-1111-4111-8111-111111111111')
                .map((id) => [id, 'Risk assessment']),
            ),
        ),
      characterProfiles: jest.fn().mockImplementation(async (ids: string[]) =>
        ids.includes('ch-1')
          ? [
              {
                id: 'ch-1',
                name: 'Asha',
                summary: '',
                profileText: '',
                hasVoices: true,
              },
            ]
          : [],
      ),
      listLanguages: jest
        .fn()
        .mockResolvedValue([
          { id: 'l-1', name: 'English (US)', code: 'en-US', voiceCount: 3 },
        ]),
      listTriggerWarnings: jest
        .fn()
        .mockResolvedValue([{ id: 'tw-1', name: 'Suicide' }]),
      listCompetencies: jest.fn().mockResolvedValue([]),
      getBehaviours: jest.fn(),
    };
    fitCheck = { suggest: jest.fn() };
    service = new RoleplayInterviewToolsService(
      { update } as any,
      library as any,
      {
        get: (id: string) =>
          id === 'helpline-responders'
            ? { id: 'helpline-responders', name: 'Helpline responders' }
            : null,
        list: () => [],
        match: () => [],
      } as any,
      fitCheck as any,
    );
  });

  it('offers the validated belt: ask_trainer with a message, finish_turn, edits and lookups', () => {
    const tools = service.getToolDefinitions();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'ask_trainer',
        'finish_turn',
        'update_brief',
        'propose_plan',
        'list_competencies',
        'get_competency_behaviours',
        'list_learner_profiles',
        'get_learner_profile',
        'search_characters',
        'list_languages',
      ]),
    );
    // No ContextToolsService injected: no design guidance tool.
    expect(names).not.toContain('design_guidance_search');
    const ask = tools.find((tool) => tool.name === 'ask_trainer')!;
    expect(ask.input_schema.required).toContain('message');
  });

  describe('update_brief', () => {
    it('merges the patch, sets names from the library and emits a brief frame', async () => {
      const ctx = context({ brief: { goal: 'Old goal', notes: ['first'] } });
      const out = await service.execute(
        'update_brief',
        {
          learners: { who: 'Helpline volunteers' },
          competencyIds: ['11111111-1111-4111-8111-111111111111'],
          competencyNames: ['Made up by the model'],
          learnerProfileId: 'helpline-responders',
          client: { characterId: 'ch-1', characterName: 'Not Asha' },
          languages: ['en-US'],
          triggerWarningIds: ['tw-1'],
          notes: ['second'],
        },
        ctx,
      );
      expect(out.modelResult.ok).toBe(true);
      const brief = out.modelResult.brief;
      expect(brief.goal).toBe('Old goal');
      expect(brief.competencyNames).toEqual(['Risk assessment']);
      expect(brief.learnerProfileName).toBe('Helpline responders');
      expect(brief.client).toEqual({
        characterId: 'ch-1',
        characterName: 'Asha',
      });
      expect(brief.languages).toEqual([
        { languageId: 'l-1', label: 'English (US)', code: 'en-US' },
      ]);
      expect(brief.notes).toEqual(['first', 'second']);
      expect(out.modelResult.ignoredKeys).toEqual(['competencyNames']);
      expect(out.modelResult.stillNeeded).toEqual(['the mode']);
      expect(out.events).toEqual([
        { event: 'brief', data: { brief, stillNeeded: ['the mode'] } },
      ]);
      expect(update).toHaveBeenCalledWith({ id: 's-1' }, { brief });
      expect(ctx.session.brief).toBe(brief);
      expect([...ctx.changes.briefFields]).toEqual(
        expect.arrayContaining([
          'learners',
          'competencyIds',
          'client',
          'notes',
        ]),
      );
    });

    it('records nothing when an id is unknown', async () => {
      const ctx = context();
      const out = await service.execute(
        'update_brief',
        { goal: 'x', competencyIds: ['nope'] },
        ctx,
      );
      expect(out.modelResult.ok).toBe(false);
      expect(out.modelResult.errors[0]).toContain('nope');
      expect(update).not.toHaveBeenCalled();
      expect(ctx.changes.briefFields.size).toBe(0);
    });

    it('sends a ready plan back to interviewing when the brief changes', async () => {
      const ctx = context({
        brief: COMPLETE_BRIEF,
        plan: { version: 1 },
        planVersion: 1,
        status: RoleplayInterviewStatus.PLAN_READY,
      });
      const out = await service.execute(
        'update_brief',
        { difficulty: 'HARD' },
        ctx,
      );
      expect(out.modelResult.planStale).toEqual(expect.any(String));
      expect(ctx.session.status).toBe(RoleplayInterviewStatus.INTERVIEWING);
    });
  });

  describe('propose_plan', () => {
    it('is refused while the brief is incomplete', async () => {
      const ctx = context({ brief: { goal: 'x' } });
      const out = await service.execute('propose_plan', PLAN_INPUT, ctx);
      expect(out.modelResult).toEqual(
        expect.objectContaining({ ok: false, error: 'brief_incomplete' }),
      );
      expect(out.modelResult.stillNeeded).toContain('a competency');
      expect(update).not.toHaveBeenCalled();
    });

    it('stores the plan with supports from the mode and ends the turn', async () => {
      const ctx = context({
        brief: { ...COMPLETE_BRIEF, mode: 'learning' },
        planVersion: 2,
      });
      const out = await service.execute('propose_plan', PLAN_INPUT, ctx);
      expect(out.modelResult).toEqual({ ok: true, planVersion: 3 });
      expect(out.endTurn).toBe(true);
      const plan = out.events![0].data.plan;
      expect(out.events![0]).toEqual({
        event: 'plan',
        data: { plan, planVersion: 3 },
      });
      expect(plan.supports.supervisorNotesEnabled).toBe(true);
      expect(ctx.session.status).toBe(RoleplayInterviewStatus.PLAN_READY);
      expect(ctx.changes.planVersion).toBe(3);
    });

    it('lists what is wrong with an invalid plan', async () => {
      const ctx = context({ brief: COMPLETE_BRIEF });
      const out = await service.execute('propose_plan', { title: 'x' }, ctx);
      expect(out.modelResult.error).toBe('invalid_plan');
      expect(out.modelResult.errors.length).toBeGreaterThan(3);
    });
  });

  describe('search_characters', () => {
    it('builds a structured brief for the fit check', async () => {
      fitCheck.suggest.mockResolvedValue({
        characters: [
          {
            id: 'ch-1',
            name: 'Asha',
            summary: '34',
            profileText: 'p',
            hasVoices: true,
          },
        ],
        recommendedId: 'ch-1',
        reason: 'fits',
        searchFailed: false,
      });
      const ctx = context({ brief: COMPLETE_BRIEF });
      const out = await service.execute(
        'search_characters',
        { description: 'a tired student' },
        ctx,
      );
      expect(out.modelResult.recommendedId).toBe('ch-1');
      const [brief, scope] = fitCheck.suggest.mock.calls[0];
      expect(brief.character.personaBrief).toBe('a tired student');
      expect(brief.mode).toBe('practice');
      expect(scope).toEqual(
        expect.objectContaining({
          sessionId: 's-1',
          tenantId: 't-1',
          competencyIds: ['11111111-1111-4111-8111-111111111111'],
        }),
      );
    });

    it('never fails the turn when the search throws', async () => {
      fitCheck.suggest.mockRejectedValue(new Error('boom'));
      const out = await service.execute(
        'search_characters',
        { description: 'x' },
        context(),
      );
      expect(out.modelResult.ok).toBe(true);
      expect(out.modelResult.searchFailed).toBe(true);
    });
  });

  it('returns every competency when a search matches none, so the model never sees an empty library', async () => {
    library.listCompetencies = jest
      .fn()
      .mockImplementation(async (query?: string) =>
        query
          ? []
          : [
              {
                id: '11111111-1111-4111-8111-111111111111',
                name: 'Assessment of Harm & Response Planning',
              },
            ],
      );
    const out = await service.execute(
      'list_competencies',
      { query: 'risk assessment' },
      context(),
    );
    expect(out.modelResult.competencies).toHaveLength(1);
    expect(out.modelResult.note).toMatch(/Nothing is named "risk assessment"/);
  });

  it('answers a non-id competency with a clear miss, not a database error', async () => {
    const out = await service.execute(
      'get_competency_behaviours',
      { competencyId: 'risk_assessment_placeholder' },
      context(),
    );
    expect(out.modelResult).toMatchObject({
      ok: false,
      error: 'unknown_competency',
    });
    expect(library.competencyNames).not.toHaveBeenCalledWith([
      'risk_assessment_placeholder',
    ]);
  });
});

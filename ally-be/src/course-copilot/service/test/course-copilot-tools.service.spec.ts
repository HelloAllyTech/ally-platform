import { validate as isUuid } from 'uuid';
import { CourseCopilotSessionStatus as Status } from '../../enum/course-copilot.enum';
import {
  ClCollectionId,
  ClUseCase,
} from 'src/context-library/enum/context-library.enum';
import { COURSE_COPILOT_GUIDANCE_TOOLS } from '../../constants/course-copilot-guidance.constants';
import { CourseBrief } from '../../type/course-copilot.type';
import { CourseCopilotBriefService } from '../course-copilot-brief.service';
import { EDIT_TOOL_DEFINITIONS } from '../course-copilot-edit-tools.service';
import { CourseCopilotToolsService } from '../course-copilot-tools.service';
import { makeBrief } from '../specialists/test/specialist-test.fixtures';
import { makeSession } from './course-copilot-test.fixtures';

const INTERVIEW_TOOL_NAMES = [
  'ask_trainer',
  'update_brief',
  'list_competencies',
  'get_competency_behaviours',
  'get_languages',
  'get_trigger_warnings',
  'list_cover_images',
  'search_library',
  'design_guidance_search',
  'design_guidance_get',
];
const EDIT_TOOL_NAMES = EDIT_TOOL_DEFINITIONS.map((tool) => tool.name);

describe('CourseCopilotToolsService', () => {
  let service: CourseCopilotToolsService;
  let sessionRepository: { update: jest.Mock };
  let blueprintService: { propose: jest.Mock; applyPatch: jest.Mock };
  let library: Record<string, jest.Mock>;
  let guidance: { runSearch: jest.Mock; runGet: jest.Mock };
  let editTools: { execute: jest.Mock };

  beforeEach(() => {
    sessionRepository = { update: jest.fn().mockResolvedValue(undefined) };
    blueprintService = { propose: jest.fn(), applyPatch: jest.fn() };
    library = {
      listCompetencies: jest
        .fn()
        .mockResolvedValue([{ id: 'c-1', name: 'Listening' }]),
      getBehaviours: jest.fn().mockResolvedValue({ behaviours: [] }),
      listLanguages: jest
        .fn()
        .mockResolvedValue([{ id: 1, name: 'English', code: 'en' }]),
      listTriggerWarnings: jest.fn().mockResolvedValue([]),
      listCoverImages: jest.fn().mockResolvedValue([]),
      search: jest
        .fn()
        .mockResolvedValue({ hits: [], noConfidentMatch: false }),
    };
    guidance = { runSearch: jest.fn(), runGet: jest.fn() };
    editTools = {
      execute: jest
        .fn()
        .mockResolvedValue({ modelResult: { ok: true }, summary: 'edited' }),
    };
    service = new CourseCopilotToolsService(
      sessionRepository as any,
      new CourseCopilotBriefService(),
      blueprintService as any,
      library as any,
      guidance as any,
      editTools as any,
    );
  });

  const session = (status: Status, extra: Record<string, any> = {}) =>
    makeSession({ status, trackId: null, brief: {}, ...extra });
  const namesFor = (s: ReturnType<typeof makeSession>) =>
    service.getToolDefinitions(s).map((tool) => tool.name);
  const exec = (
    name: string,
    input: Record<string, any>,
    s: ReturnType<typeof makeSession>,
    answer?: any,
  ) =>
    service.execute(name, input, {
      session: s,
      userId: 7,
      ...(answer ? { answer } : {}),
    });

  // ── What the model can see, by state ─────────────────────────────────────

  describe('tool exposure by session status', () => {
    it('INTERVIEWING: the interview tools and propose_blueprint — nothing that needs a blueprint or a course', () => {
      expect(namesFor(session(Status.INTERVIEWING))).toEqual([
        ...INTERVIEW_TOOL_NAMES,
        'propose_blueprint',
      ]);
    });

    it('AWAITING_BLUEPRINT adds update_blueprint', () => {
      expect(namesFor(session(Status.AWAITING_BLUEPRINT))).toEqual([
        ...INTERVIEW_TOOL_NAMES,
        'propose_blueprint',
        'update_blueprint',
      ]);
    });

    it.each([Status.BUILDING, Status.BUILD_FAILED])(
      '%s: the interview tools plus only the read-only course tools',
      (status) => {
        const names = namesFor(session(status, { trackId: 'track-1' }));
        expect(names).toEqual([
          ...INTERVIEW_TOOL_NAMES,
          'get_course_outline',
          'get_item',
        ]);
        // Nothing may write the course while the runner is rewriting it.
        for (const writer of [
          'add_item',
          'remove_item',
          'publish_course',
          'propose_blueprint',
          'update_blueprint',
        ]) {
          expect(names).not.toContain(writer);
        }
      },
    );

    it('EDITING with a course: the interview tools and every edit tool, but no blueprint tools', () => {
      const names = namesFor(session(Status.EDITING, { trackId: 'track-1' }));
      expect(names).toEqual([...INTERVIEW_TOOL_NAMES, ...EDIT_TOOL_NAMES]);
      expect(names).toEqual(
        expect.arrayContaining([
          'get_course_outline',
          'add_item',
          'publish_course',
          'duplicate_course',
        ]),
      );
      expect(names).not.toContain('propose_blueprint');
      expect(names).not.toContain('update_blueprint');
    });

    it('EDITING without a bound course falls back to the interview tools', () => {
      expect(namesFor(session(Status.EDITING))).toEqual(INTERVIEW_TOOL_NAMES);
    });

    it('ARCHIVED exposes nothing', () => {
      expect(
        namesFor(session(Status.ARCHIVED, { trackId: 'track-1' })),
      ).toEqual([]);
    });

    it('gives every tool a name, a description and an object schema', () => {
      const all = service.getToolDefinitions(
        session(Status.EDITING, { trackId: 't' }),
      );
      expect(new Set(all.map((t) => t.name)).size).toBe(all.length); // no duplicates
      for (const tool of all) {
        expect(tool.description.length).toBeGreaterThan(10);
        expect(tool.input_schema).toMatchObject({ type: 'object' });
      }
    });
  });

  describe('validated turns', () => {
    const validatedNames = (s: ReturnType<typeof makeSession>) =>
      service
        .getToolDefinitions(s, { validatedTurns: true })
        .map((tool) => tool.name);

    it('adds finish_turn and gives ask_trainer the reply, in every state that has tools', () => {
      for (const status of [
        Status.INTERVIEWING,
        Status.AWAITING_BLUEPRINT,
        Status.BUILDING,
        Status.EDITING,
      ]) {
        const s = session(status, { trackId: 't-1' });
        expect(validatedNames(s)).toEqual([...namesFor(s), 'finish_turn']);
        const ask = service
          .getToolDefinitions(s, { validatedTurns: true })
          .find((tool) => tool.name === 'ask_trainer')!;
        expect(ask.input_schema.required).toEqual(
          expect.arrayContaining(['prompt', 'kind', 'message']),
        );
        expect(Object.keys(ask.input_schema.properties)).toEqual(
          expect.arrayContaining(['message', 'unchangedBecause']),
        );
      }
    });

    it('exposes nothing for an archived session either way', () => {
      expect(validatedNames(session(Status.ARCHIVED))).toEqual([]);
    });

    it('runs finish_turn only in a validated turn', async () => {
      const s = session(Status.INTERVIEWING);
      await expect(
        exec('finish_turn', { message: 'Done.' }, s),
      ).resolves.toMatchObject({
        modelResult: { ok: false, error: 'tool_unavailable' },
      });
      await expect(
        service.execute(
          'finish_turn',
          { message: 'Done.' },
          {
            session: s,
            userId: 7,
            validatedTurns: true,
          },
        ),
      ).resolves.toMatchObject({ modelResult: { ok: true }, endTurn: true });
    });
  });

  describe('execute', () => {
    it.each([
      ['update_blueprint', Status.INTERVIEWING],
      ['add_item', Status.BUILDING],
      ['publish_course', Status.AWAITING_BLUEPRINT],
      ['propose_blueprint', Status.EDITING],
      ['ask_trainer', Status.ARCHIVED],
    ])(
      'refuses %s while the session is %s, without running it',
      async (tool, status) => {
        const outcome = await exec(
          tool,
          { prompt: 'x', kind: 'freeText' },
          session(status, { trackId: 'track-1' }),
        );

        expect(outcome.modelResult).toMatchObject({
          ok: false,
          error: 'tool_unavailable',
        });
        expect(outcome.modelResult.message).toContain(tool);
        expect(outcome.modelResult.message).toContain(status);
        expect(outcome.endTurn).toBeUndefined();
        expect(editTools.execute).not.toHaveBeenCalled();
        expect(blueprintService.propose).not.toHaveBeenCalled();
      },
    );

    it('hands exposed edit tools to the edit service, with the same context', async () => {
      const s = session(Status.EDITING, { trackId: 'track-1' });
      const answer = { questionId: 'q', selectedOptionIds: ['confirm'] };

      const outcome = await exec('remove_item', { itemId: 'i' }, s, answer);

      expect(editTools.execute).toHaveBeenCalledWith(
        'remove_item',
        { itemId: 'i' },
        { session: s, userId: 7, answer },
      );
      expect(outcome.summary).toBe('edited');
    });

    it('lets read-only edit tools through while a build is running', async () => {
      await exec(
        'get_course_outline',
        {},
        session(Status.BUILDING, { trackId: 'track-1' }),
      );
      expect(editTools.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ── ask_trainer ──────────────────────────────────────────────────────────

  describe('ask_trainer', () => {
    const ask = (input: Record<string, any>) =>
      exec('ask_trainer', input, session(Status.INTERVIEWING));

    it('mints a uuid, emits the question, and ends the turn', async () => {
      const outcome = await ask({
        prompt: 'Who is this for?',
        kind: 'freeText',
      });

      const question = outcome.events![0].data;
      expect(outcome.events![0].event).toBe('question');
      expect(isUuid(question.id)).toBe(true);
      expect(question.prompt).toBe('Who is this for?');
      expect(outcome.endTurn).toBe(true);
      expect(outcome.modelResult).toMatchObject({
        ok: true,
        questionId: question.id,
      });
      expect(outcome.summary).toBe('Asked: Who is this for?');
    });

    it('mints a fresh id for each question — the model cannot choose one', async () => {
      const a = (
        await ask({ prompt: 'a', kind: 'freeText', id: 'model-chosen' })
      ).events![0].data;
      const b = (await ask({ prompt: 'a', kind: 'freeText' })).events![0].data;
      expect(a.id).not.toBe('model-chosen');
      expect(a.id).not.toBe(b.id);
    });

    it('keeps one recommended option — the first — however many the model marks', async () => {
      const question = (
        await ask({
          prompt: 'How long?',
          kind: 'singleSelect',
          options: [
            { id: 'a', label: '30 min', recommended: true },
            { id: 'b', label: '60 min', recommended: true },
            { id: 'c', label: '120 min', description: 'A half day' },
            { id: 'd', label: '240 min', recommended: true },
          ],
        })
      ).events![0].data;

      expect(question.options.filter((o: any) => o.recommended)).toEqual([
        { id: 'a', label: '30 min', recommended: true },
      ]);
      expect(question.options[2]).toEqual({
        id: 'c',
        label: '120 min',
        description: 'A half day',
      });
      expect(question.options).toHaveLength(4);
    });

    it('turns allowCustom on for every select kind unless the model says otherwise', async () => {
      for (const kind of ['singleSelect', 'multiSelect', 'dropdown']) {
        const question = (
          await ask({ prompt: 'p', kind, options: [{ id: 'a', label: 'A' }] })
        ).events![0].data;
        expect(question.allowCustom).toBe(true);
      }
    });

    it('does not turn allowCustom on for free text', async () => {
      expect(
        (await ask({ prompt: 'p', kind: 'freeText' })).events![0].data
          .allowCustom,
      ).toBe(false);
    });

    it('accepts plain-string options, using the text as id and label', async () => {
      const question = (
        await ask({
          prompt: 'p',
          kind: 'singleSelect',
          options: ['Hindi', '  ', 'Tamil'],
        })
      ).events![0].data;
      expect(question.options).toEqual([
        { id: 'Hindi', label: 'Hindi' },
        { id: 'Tamil', label: 'Tamil' },
      ]);
    });

    it('falls back to a free-text question when a select has no usable options', async () => {
      const question = (
        await ask({ prompt: 'p', kind: 'singleSelect', options: [] })
      ).events![0].data;
      expect(question.kind).toBe('freeText');
      expect(question).not.toHaveProperty('options');
    });

    it('treats an unknown kind as free text, and passes limits and the rationale through', async () => {
      expect(
        (await ask({ prompt: 'p', kind: 'slider' })).events![0].data.kind,
      ).toBe('freeText');

      const question = (
        await ask({
          prompt: 'Pick some',
          kind: 'multiSelect',
          rationale: 'You said both groups matter',
          options: [{ id: 'a', label: 'A' }],
          allowNone: true,
          minSelections: 1,
          maxSelections: 2,
        })
      ).events![0].data;
      expect(question).toMatchObject({
        rationale: 'You said both groups matter',
        allowNone: true,
        minSelections: 1,
        maxSelections: 2,
      });
    });
  });

  // ── Brief ────────────────────────────────────────────────────────────────

  describe('update_brief', () => {
    const update = (ops: any, s = session(Status.INTERVIEWING)) =>
      exec('update_brief', { ops }, s);

    it('persists the patched brief, emits it with its readiness, and updates the in-memory session', async () => {
      const s = session(Status.INTERVIEWING);
      const outcome = await update(
        [
          { op: 'add', path: '/seed', value: 'Teach de-escalation' },
          { op: 'add', path: '/audience/who', value: 'New volunteers' },
        ],
        s,
      );

      const expected: CourseBrief = {
        seed: 'Teach de-escalation',
        audience: { who: 'New volunteers' },
      };
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { brief: expected },
      );
      expect(s.brief).toEqual(expected);
      expect(outcome.events).toEqual([
        {
          event: 'brief',
          data: {
            brief: expected,
            readiness: expect.objectContaining({ ready: false }),
          },
        },
      ]);
      expect(outcome.modelResult).toMatchObject({
        ok: true,
        readyForBlueprint: false,
      });
      expect(outcome.modelResult.stillMissing).toContain('the language');
      expect(outcome.endTurn).toBeUndefined(); // the interview carries on
    });

    it('reports readiness once the brief is complete', async () => {
      const outcome = await update(
        [{ op: 'add', path: '/shape/languageIds', value: ['1'] }],
        session(Status.INTERVIEWING, {
          brief: { ...makeBrief(), shape: { durationMinutes: 60 } },
        }),
      );
      expect(outcome.modelResult).toMatchObject({
        ok: true,
        readyForBlueprint: true,
        stillMissing: [],
      });
    });

    it('tells the model which keys were NOT stored, and where to put them', async () => {
      const outcome = await update([
        { op: 'add', path: '/seed', value: 'x' },
        { op: 'add', path: '/mood', value: 'upbeat' },
      ]);
      expect(outcome.modelResult.ignoredKeys).toEqual([
        'mood — not a brief field, so it was NOT stored. Put it in /notes.',
      ]);
      // The valid part of the patch still landed.
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { brief: { seed: 'x' } },
      );
    });

    it('omits ignoredKeys when there are none', async () => {
      const outcome = await update([{ op: 'add', path: '/seed', value: 'x' }]);
      expect(outcome.modelResult).not.toHaveProperty('ignoredKeys');
    });

    it('rejects an empty or missing patch without touching the brief', async () => {
      for (const ops of [[], undefined, 'nope']) {
        const outcome = await update(ops);
        expect(outcome.modelResult).toMatchObject({
          ok: false,
          error: 'no_ops',
        });
      }
      expect(sessionRepository.update).not.toHaveBeenCalled();
    });

    it('soft-fails a patch that cannot apply, with a hint, persisting nothing', async () => {
      const s = session(Status.INTERVIEWING, { brief: { notes: ['keep me'] } });
      const outcome = await update(
        [{ op: 'replace', path: '/notes', value: [] }],
        s,
      );

      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'patch_failed',
      });
      expect(outcome.modelResult.message).toMatch(/Notes only grow/);
      expect(outcome.modelResult.hint).toMatch(/Append to arrays/);
      expect(outcome.events).toBeUndefined();
      expect(sessionRepository.update).not.toHaveBeenCalled();
      expect(s.brief).toEqual({ notes: ['keep me'] });
    });

    it('soft-fails a patch against a path that does not exist', async () => {
      const outcome = await update([
        { op: 'replace', path: '/seed', value: 'x' },
      ]);
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'patch_failed',
      });
    });
  });

  // ── Blueprint ────────────────────────────────────────────────────────────

  describe('propose_blueprint', () => {
    const response = () => ({
      version: 1,
      blueprint: {
        sections: [
          {
            title: 'One',
            items: [
              { type: 'ARTICLE', title: 'Read' },
              { type: 'QUIZ', title: 'Check' },
            ],
          },
        ],
      },
      estimate: { usd: 2, minutes: 40, items: 2, newRoleplays: 0, images: 1 },
      problems: [],
    });

    it('is refused, with what is missing, when the brief is not ready', async () => {
      const outcome = await exec(
        'propose_blueprint',
        {},
        session(Status.INTERVIEWING, { brief: { seed: 'x' } }),
      );

      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'brief_not_ready',
      });
      expect(outcome.modelResult.missing).toEqual([
        'who the learners are',
        'the end-of-course outcome',
        'at least one competency',
        'how mastery is assessed',
        'the time budget',
        'the language',
      ]);
      expect(outcome.endTurn).toBeUndefined();
      expect(outcome.events).toBeUndefined();
      expect(blueprintService.propose).not.toHaveBeenCalled();
      expect(outcome.summary).toMatch(/still needed: who the learners are/);
    });

    it('plans, emits the blueprint, and ends the turn when the brief is ready', async () => {
      blueprintService.propose.mockResolvedValue(response());
      const s = session(Status.INTERVIEWING, { brief: makeBrief() });

      const outcome = await exec(
        'propose_blueprint',
        { notes: 'Keep it short' },
        s,
      );

      expect(blueprintService.propose).toHaveBeenCalledWith(s, 'Keep it short');
      expect(outcome.endTurn).toBe(true);
      expect(outcome.events).toEqual([
        { event: 'blueprint', data: response() },
      ]);
      expect(outcome.modelResult).toMatchObject({
        ok: true,
        version: 1,
        sections: [{ title: 'One', items: ['ARTICLE: Read', 'QUIZ: Check'] }],
        estimate: { usd: 2 },
        problems: [],
      });
      expect(outcome.summary).toBe('Drafted a blueprint: 1 sections, 2 items');
      // The rest of this turn (and the tool set) now reflects the new state.
      expect(s.status).toBe(Status.AWAITING_BLUEPRINT);
    });

    it('passes no notes when the model gave none', async () => {
      blueprintService.propose.mockResolvedValue(response());
      await exec(
        'propose_blueprint',
        {},
        session(Status.INTERVIEWING, { brief: makeBrief() }),
      );
      expect(blueprintService.propose.mock.calls[0][1]).toBeUndefined();
    });

    it('soft-fails when the planner throws: no turn end, status unchanged, nothing leaked', async () => {
      blueprintService.propose.mockRejectedValue(
        new Error('provider 529 overloaded'),
      );
      const s = session(Status.INTERVIEWING, { brief: makeBrief() });

      const outcome = await exec('propose_blueprint', {}, s);

      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'planner_failed',
      });
      expect(JSON.stringify(outcome.modelResult)).not.toContain('529');
      expect(outcome.endTurn).toBeUndefined();
      expect(s.status).toBe(Status.INTERVIEWING);
    });

    it('can be called again from AWAITING_BLUEPRINT to re-plan', async () => {
      blueprintService.propose.mockResolvedValue(response());
      const outcome = await exec(
        'propose_blueprint',
        {},
        session(Status.AWAITING_BLUEPRINT, { brief: makeBrief() }),
      );
      expect(outcome.modelResult.ok).toBe(true);
    });
  });

  describe('update_blueprint', () => {
    const awaiting = () =>
      session(Status.AWAITING_BLUEPRINT, { brief: makeBrief() });
    const response = {
      version: 3,
      blueprint: {
        sections: [
          {
            title: 'One',
            items: [{ id: 'i1', type: 'ARTICLE', title: 'Read' }],
          },
        ],
      },
      estimate: { usd: 1 },
      problems: ['Section "One" has no assessment'],
    };

    it('applies the patch and echoes the sections with indexes and ids, so the next patch can address them', async () => {
      blueprintService.applyPatch.mockResolvedValue(response);
      const s = awaiting();
      const ops = [
        {
          op: 'replace',
          path: '/sections/0/items/0/title',
          value: 'Read first',
        },
      ];

      const outcome = await exec('update_blueprint', { ops }, s);

      expect(blueprintService.applyPatch).toHaveBeenCalledWith(s, ops);
      expect(outcome.modelResult).toMatchObject({
        ok: true,
        version: 3,
        problems: ['Section "One" has no assessment'],
        sections: [
          {
            index: 0,
            title: 'One',
            items: [{ index: 0, id: 'i1', type: 'ARTICLE', title: 'Read' }],
          },
        ],
      });
      expect(outcome.events).toEqual([{ event: 'blueprint', data: response }]);
      expect(outcome.endTurn).toBeUndefined();
    });

    it('rejects an empty patch', async () => {
      const outcome = await exec('update_blueprint', { ops: [] }, awaiting());
      expect(outcome.modelResult).toMatchObject({ ok: false, error: 'no_ops' });
      expect(blueprintService.applyPatch).not.toHaveBeenCalled();
    });

    it('soft-fails when the patch is refused, so the model can repair it', async () => {
      blueprintService.applyPatch.mockRejectedValue(
        new Error('Path "/sections/9" does not exist'),
      );
      const outcome = await exec(
        'update_blueprint',
        { ops: [{ op: 'remove', path: '/sections/9' }] },
        awaiting(),
      );
      expect(outcome.modelResult).toEqual({
        ok: false,
        error: 'patch_failed',
        message: 'Path "/sections/9" does not exist',
      });
      expect(outcome.summary).toMatch(/Blueprint patch rejected/);
    });
  });

  // ── Lookups ──────────────────────────────────────────────────────────────

  describe('design guidance', () => {
    const interviewing = () =>
      session(Status.INTERVIEWING, { id: 'sess-1', tenantId: 'org-7' });

    it('exposes the Context Library tool pair under the design_guidance names', () => {
      const tools = service.getToolDefinitions(interviewing());
      const search = tools.find((t) => t.name === 'design_guidance_search')!;
      const get = tools.find((t) => t.name === 'design_guidance_get')!;
      expect(search.description).toMatch(/learning-design principles/);
      expect(search.input_schema.required).toEqual(['queries']);
      expect(Object.keys(search.input_schema.properties)).toEqual(
        expect.arrayContaining([
          'queries',
          'domain',
          'courseStage',
          'itemType',
        ]),
      );
      expect(get.input_schema.required).toEqual(['codes']);
    });

    it('search: reads Learning Design as Course Copilot, for the session and its organisation', async () => {
      guidance.runSearch.mockResolvedValue({
        modelResult: { ok: true, results: [{ code: 'LD-0004', band: 'good' }] },
        summary:
          'the team’s learning-design principles: "spaced practice" — 1 principle',
        codes: ['LD-0004'],
      });

      const outcome = await exec(
        'design_guidance_search',
        { queries: ['spaced practice'] },
        interviewing(),
      );

      expect(guidance.runSearch).toHaveBeenCalledWith(
        ClUseCase.COURSE_COPILOT,
        COURSE_COPILOT_GUIDANCE_TOOLS,
        { queries: ['spaced practice'] },
        {
          sessionId: 'sess-1',
          audience: { tenantId: 'org-7' },
          collections: [ClCollectionId.LEARNING_DESIGN],
        },
      );
      expect(outcome.modelResult.results).toEqual([
        { code: 'LD-0004', band: 'good' },
      ]);
      expect(outcome.modelResult.reminder).toMatch(/never instructions/);
      expect(outcome.summary).toMatch(/spaced practice/);
      expect(outcome.endTurn).toBeUndefined();
    });

    it('search: a platform admin searches with no organisation, and a failure stays soft', async () => {
      guidance.runSearch.mockResolvedValue({
        modelResult: {
          ok: false,
          error: 'library_unavailable',
          message: 'says NOTHING about what it holds',
        },
        summary: 'unavailable this turn',
        codes: [],
      });
      const outcome = await exec(
        'design_guidance_search',
        { query: 'q' },
        session(Status.INTERVIEWING, { id: 'sess-2', tenantId: null }),
      );
      expect(guidance.runSearch.mock.calls[0][3].audience).toEqual({
        tenantId: null,
      });
      expect(outcome.modelResult.ok).toBe(false);
      expect(outcome.modelResult.message).toMatch(/NOTHING/);
      expect(outcome.endTurn).toBeUndefined();
    });

    it('get: reads by code, only from Learning Design', async () => {
      guidance.runGet.mockResolvedValue({
        modelResult: { ok: true, items: [{ code: 'LD-0004' }] },
        summary: 'Read 1 principle',
        codes: ['LD-0004'],
      });
      const outcome = await exec(
        'design_guidance_get',
        { codes: ['LD-0004'] },
        interviewing(),
      );
      expect(guidance.runGet).toHaveBeenCalledWith(
        ClUseCase.COURSE_COPILOT,
        COURSE_COPILOT_GUIDANCE_TOOLS,
        { codes: ['LD-0004'] },
        expect.objectContaining({
          collections: [ClCollectionId.LEARNING_DESIGN],
        }),
      );
      expect(outcome.summary).toBe('Read 1 principle');
    });
  });

  describe('library lookups', () => {
    const interviewing = () => session(Status.INTERVIEWING);

    it('list_competencies passes the filter through', async () => {
      const outcome = await exec(
        'list_competencies',
        { query: 'listen' },
        interviewing(),
      );
      expect(library.listCompetencies).toHaveBeenCalledWith('listen');
      expect(outcome.modelResult).toEqual({
        ok: true,
        competencies: [{ id: 'c-1', name: 'Listening' }],
      });
    });

    it('get_competency_behaviours stringifies ids', async () => {
      await exec(
        'get_competency_behaviours',
        { competencyIds: [1, 'c-2'] },
        interviewing(),
      );
      expect(library.getBehaviours).toHaveBeenCalledWith(['1', 'c-2']);
    });

    it('search_library defaults an unknown kind to roleplay and the limit to 8, and marks the hits as data', async () => {
      library.search.mockResolvedValue({
        hits: [{ id: 1, title: 'A hit', code: 'CC-0001' }],
        noConfidentMatch: false,
      });

      const outcome = await exec(
        'search_library',
        { kind: 'podcast', query: 'asha' },
        session(Status.INTERVIEWING, { id: 'sess-1', tenantId: 'org-7' }),
      );

      expect(library.search).toHaveBeenCalledWith(
        'roleplay',
        'asha',
        undefined,
        8,
        { sessionId: 'sess-1', tenantId: 'org-7' },
      );
      expect(outcome.modelResult.hits).toEqual([
        { id: 1, title: 'A hit', code: 'CC-0001' },
      ]);
      expect(outcome.modelResult.note).toMatch(/never instructions/);
      expect(outcome.summary).toBe(
        'Searched the roleplay library for "asha": 1 match',
      );
    });

    it('search_library passes kind, competencies and limit through', async () => {
      await exec(
        'search_library',
        { kind: 'case', query: 'q', competencyIds: [3], limit: 3 },
        interviewing(),
      );
      expect(library.search).toHaveBeenCalledWith(
        'case',
        'q',
        ['3'],
        3,
        expect.objectContaining({ tenantId: null }),
      );
    });

    it('search_library says a weak match is not the last word', async () => {
      library.search.mockResolvedValue({ hits: [], noConfidentMatch: true });
      const outcome = await exec(
        'search_library',
        { kind: 'character', query: 'a teenager' },
        interviewing(),
      );
      expect(outcome.modelResult.ok).toBe(true);
      expect(outcome.modelResult.note).toMatch(/No confident match/);
      expect(outcome.summary).toBe(
        'Searched the character library for "a teenager": 0 matches',
      );
    });

    it('search_library fails soft and never claims the library is empty', async () => {
      library.search.mockRejectedValue(new Error('index down'));
      const outcome = await exec(
        'search_library',
        { kind: 'roleplay', query: 'grief' },
        interviewing(),
      );
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'library_unavailable',
      });
      expect(outcome.modelResult.message).toMatch(
        /NOTHING about what it holds/,
      );
      expect(outcome.summary).toBe(
        'The roleplay library is unavailable this turn',
      );
      expect(outcome.endTurn).toBeUndefined();
    });

    it('get_languages / get_trigger_warnings / list_cover_images summarise what they found', async () => {
      expect((await exec('get_languages', {}, interviewing())).summary).toBe(
        'Looked up 1 languages',
      );
      expect(
        (await exec('get_trigger_warnings', {}, interviewing())).modelResult,
      ).toEqual({ ok: true, triggerWarnings: [] });
      await exec('list_cover_images', {}, interviewing());
      expect(library.listCoverImages).toHaveBeenCalledWith(12);
      await exec('list_cover_images', { limit: 4 }, interviewing());
      expect(library.listCoverImages).toHaveBeenLastCalledWith(4);
    });
  });

  describe('questionsFrom', () => {
    it('picks the question frames out of a tool outcome', () => {
      const frames = [
        { event: 'brief', data: { a: 1 } },
        { event: 'question', data: { id: 'q1' } },
      ] as any;
      expect(CourseCopilotToolsService.questionsFrom(frames)).toEqual([
        { id: 'q1' },
      ]);
      expect(CourseCopilotToolsService.questionsFrom(undefined)).toEqual([]);
    });
  });
});

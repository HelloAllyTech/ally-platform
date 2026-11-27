import {
  CourseCopilotMode,
  CourseCopilotSessionStatus as Status,
} from '../../enum/course-copilot.enum';
import { CourseBrief } from '../../type/course-copilot.type';
import {
  briefHash,
  CONFIRM_BRIEF_OPTION,
} from '../../util/course-pilot-stages.util';
import { CourseCopilotBriefService } from '../course-copilot-brief.service';
import {
  coursePilotState,
  CourseCopilotToolsService,
} from '../course-copilot-tools.service';
import { makeSession } from './course-copilot-test.fixtures';

const complete: CourseBrief = {
  seed: 'Crisis calls for new volunteers',
  audience: { who: 'New helpline volunteers' },
  learnerProfileId: 'p1',
  outcomes: { terminal: 'Assess risk on a crisis call' },
  competencyIds: ['c1'],
  skillTargets: [{ skill: 'Risk assessment', a: 'A2', b: 'B2' }],
  assessment: { kind: 'roleplay' },
  shape: { durationMinutes: 60, languageIds: ['1'] },
};

describe('CourseCopilotToolsService with the Course Pilot stage machine', () => {
  let service: CourseCopilotToolsService;
  let query: jest.Mock;
  let researcher: { condense: jest.Mock };
  let runSearch: jest.Mock;
  let searchSources: jest.Mock;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    researcher = {
      condense: jest.fn().mockResolvedValue({
        summary: 'Use a roleplay with a pass rule.',
        points: [
          { text: 'Assess by roleplay', sources: ['Design principle FP-1'] },
        ],
        gaps: [],
      }),
    };
    runSearch = jest.fn().mockResolvedValue({
      modelResult: {
        ok: true,
        results: [{ code: 'FP-1', card: 'Practise, then assess.' }],
      },
      summary: '',
      codes: ['FP-1'],
    });
    searchSources = jest
      .fn()
      .mockResolvedValue([
        { label: 'manual.pdf', section: 'p2', text: 'Call flow.' },
      ]);
    service = new CourseCopilotToolsService(
      { update: jest.fn(), manager: { query } } as any,
      new CourseCopilotBriefService(),
      { propose: jest.fn(), applyPatch: jest.fn() } as any,
      {
        listLanguages: jest
          .fn()
          .mockResolvedValue([{ id: 1, name: 'English' }]),
      } as any,
      { runSearch, runGet: jest.fn() } as any,
      { execute: jest.fn() } as any,
      { search: searchSources } as any,
      undefined,
      undefined,
      undefined,
      researcher as any,
    );
  });

  const interviewing = (brief: CourseBrief, metadata: any = null) =>
    makeSession({
      status: Status.INTERVIEWING,
      trackId: null,
      brief,
      metadata,
    });
  const names = (session: ReturnType<typeof makeSession>, stages = true) =>
    service.getToolDefinitions(session, { stages }).map((tool) => tool.name);
  const exec = (
    name: string,
    input: any,
    session: ReturnType<typeof makeSession>,
  ) => service.execute(name, input, { session, userId: 7, stages: true });

  it('leaves the belt unchanged when the switch is off', () => {
    expect(names(interviewing({}), false)).toContain('propose_blueprint');
  });

  it('gives each stage only its own tools', () => {
    const intake = names(interviewing({}));
    expect(intake).toEqual(
      expect.arrayContaining(['ask_trainer', 'update_brief', 'research']),
    );
    // Reading goes through research: no raw reading tools on a stage belt.
    for (const reading of [
      'search_sources',
      'design_guidance_search',
      'get_example_course',
    ]) {
      expect(intake).not.toContain(reading);
    }
    expect(intake).not.toContain('propose_blueprint');
    expect(intake).not.toContain('get_languages');
    expect(names(interviewing({ ...complete, shape: {} }))).toContain(
      'get_languages',
    );
  });

  it('locks the brief in the turn right after the trainer confirms it', () => {
    const confirmed = interviewing(complete, {
      coursePilot: { confirmedBriefHash: briefHash(complete) },
    });
    const locked = service
      .getToolDefinitions(confirmed, { stages: true, justConfirmed: true })
      .map((tool) => tool.name);
    expect(locked).toContain('propose_blueprint');
    expect(locked).not.toContain('update_brief');
    // A later turn can edit again.
    expect(names(confirmed)).toContain('update_brief');
  });

  it('has no propose_blueprint until the trainer confirms this brief', () => {
    expect(names(interviewing(complete))).not.toContain('propose_blueprint');
    const confirmed = interviewing(complete, {
      coursePilot: { confirmedBriefHash: briefHash(complete) },
    });
    expect(names(confirmed)).toContain('propose_blueprint');
  });

  it('refuses a tool from another stage and says what is missing', async () => {
    const outcome = await exec(
      'propose_blueprint',
      {},
      interviewing({ seed: 'x' }),
    );
    expect(outcome.modelResult).toMatchObject({
      ok: false,
      error: 'tool_unavailable',
    });
    expect(outcome.modelResult.message).toContain('"Learners" stage');
    expect(outcome.modelResult.message).toContain('who the learners are');
  });

  it('counts questions per stage and refuses past the limit', async () => {
    const session = interviewing({ seed: 'x' });
    for (let i = 0; i < 3; i++) {
      const asked = await exec(
        'ask_trainer',
        { prompt: `Q${i}?`, kind: 'freeText' },
        session,
      );
      expect(asked.modelResult.ok).toBe(true);
    }
    expect(coursePilotState(session).questions).toEqual({
      'brief.learners': 3,
    });
    const refused = await exec(
      'ask_trainer',
      { prompt: 'One more?', kind: 'freeText' },
      session,
    );
    expect(refused.modelResult).toMatchObject({
      ok: false,
      error: 'question_limit',
    });
    expect(refused.events).toBeUndefined();
  });

  it('turns the final-check question into the confirm card and remembers its brief', async () => {
    const session = interviewing(complete);
    const outcome = await exec(
      'ask_trainer',
      {
        prompt: 'Here is the brief…',
        kind: 'multiSelect',
        options: [{ id: 'x', label: 'X' }],
      },
      session,
    );
    const card = outcome.events![0].data;
    expect(card.kind).toBe('singleSelect');
    // The card is code's: its question and summary come from the brief, not the model.
    expect(card.prompt).toContain('Is this the course you want?');
    expect(card.rationale).toContain('Outcome: Assess risk on a crisis call');
    expect(card.rationale).toContain('Skill targets: Risk assessment A2/B2');
    expect(card.rationale).toContain('Language: English');
    expect(card.options.map((o: any) => o.id)).toEqual([
      CONFIRM_BRIEF_OPTION,
      'change_brief',
    ]);
    expect(coursePilotState(session).pendingConfirm).toEqual({
      questionId: card.id,
      briefHash: briefHash(complete),
    });
    // Saved to the row with an atomic jsonb merge under metadata.coursePilot.
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'coursePilot'"),
      [session.id, expect.any(String)],
    );
  });

  it('reports the stage after a brief update', async () => {
    const session = interviewing({ seed: 'x' });
    const outcome = await exec(
      'update_brief',
      { ops: [{ op: 'add', path: '/audience', value: { who: 'Volunteers' } }] },
      session,
    );
    expect(outcome.modelResult.stage).toMatchObject({
      id: 'brief.learners',
      stillNeeded: ['the closest learner profile (/learnerProfileId)'],
    });
  });

  it('does not stage an EDIT session or a session past the interview', () => {
    const edit = makeSession({
      status: Status.EDITING,
      mode: CourseCopilotMode.EDIT,
      brief: {},
    });
    expect(names(edit)).toContain('get_item');
    const review = makeSession({
      status: Status.AWAITING_BLUEPRINT,
      trackId: null,
      brief: {},
    });
    expect(names(review)).toContain('update_blueprint');
  });

  describe('research (knowledge per stage)', () => {
    it("reads only the stage's knowledge and returns the Researcher's cited pack", async () => {
      // brief.learners: learner profiles, principles and files.
      const outcome = await exec(
        'research',
        { question: 'Who are new helpline volunteers?' },
        interviewing({ seed: 'Crisis calls' }),
      );
      expect(outcome.modelResult).toMatchObject({
        ok: true,
        summary: 'Use a roleplay with a pass rule.',
      });
      const call = researcher.condense.mock.calls[0][0];
      expect(call.stageTitle).toMatch(/Learners/);
      const sources = call.snippets.map((s: any) => s.source);
      expect(sources).toEqual(
        expect.arrayContaining([
          'Design principle FP-1',
          "Trainer's file: manual.pdf (p2)",
        ]),
      );
      expect(
        sources.some((s: string) => s.startsWith('Learner profile:')),
      ).toBe(true);
      expect(sources.some((s: string) => s.startsWith('Example course:'))).toBe(
        false,
      );
      expect(call.snippets.map((s: any) => s.id)[0]).toBe('S1');
    });

    it('skips a source that fails and still answers', async () => {
      runSearch.mockRejectedValueOnce(new Error('library down'));
      const outcome = await exec(
        'research',
        { question: 'What helps?' },
        interviewing({ seed: 'Crisis calls' }),
      );
      expect(outcome.modelResult.ok).toBe(true);
      const sources = researcher.condense.mock.calls[0][0].snippets.map(
        (s: any) => s.source,
      );
      expect(
        sources.some((s: string) => s.startsWith('Design principle')),
      ).toBe(false);
    });

    it('asks for a question when given none', async () => {
      const outcome = await exec('research', {}, interviewing({ seed: 'x' }));
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'no_question',
      });
    });
  });

  describe('stage research (run by code once per stage)', () => {
    const ctx = (session: ReturnType<typeof makeSession>) => ({
      session,
      userId: 7,
      stages: true,
    });

    it('asks the Researcher about the stage, saves the pack, and does not ask twice', async () => {
      const session = interviewing({ seed: 'Crisis calls' });
      const first = await service.stageResearch(ctx(session));
      expect(first?.stage).toBe('brief.learners');
      expect(first?.pack?.points).toHaveLength(1);
      expect(researcher.condense.mock.calls[0][0].question).toMatch(
        /Who are these learners, and what do they need from a course on: Crisis calls/,
      );
      expect(
        coursePilotState(session).research?.['brief.learners'],
      ).toBeTruthy();

      await service.stageResearch(ctx(session));
      expect(researcher.condense).toHaveBeenCalledTimes(1);
    });

    it('skips the confirm stage and remembers a stage with nothing to read', async () => {
      const atFinal = interviewing(complete);
      expect(await service.stageResearch(ctx(atFinal))).toBeNull();
      expect(researcher.condense).not.toHaveBeenCalled();
      expect(coursePilotState(atFinal).research).toEqual({
        'brief.final': null,
      });
    });

    it('never fails the turn when the Researcher fails', async () => {
      researcher.condense.mockRejectedValueOnce(new Error('model down'));
      const session = interviewing({ seed: 'Crisis calls' });
      await expect(service.stageResearch(ctx(session))).resolves.toBeNull();
    });
  });
});

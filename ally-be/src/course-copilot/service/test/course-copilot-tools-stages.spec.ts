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

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    service = new CourseCopilotToolsService(
      { update: jest.fn(), manager: { query } } as any,
      new CourseCopilotBriefService(),
      { propose: jest.fn(), applyPatch: jest.fn() } as any,
      {
        listLanguages: jest
          .fn()
          .mockResolvedValue([{ id: 1, name: 'English' }]),
      } as any,
      { runSearch: jest.fn(), runGet: jest.fn() } as any,
      { execute: jest.fn() } as any,
      { search: jest.fn().mockResolvedValue([]) } as any,
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
      expect.arrayContaining(['ask_trainer', 'update_brief', 'search_sources']),
    );
    expect(intake).not.toContain('propose_blueprint');
    expect(intake).not.toContain('get_languages');
    expect(names(interviewing({ ...complete, shape: {} }))).toContain(
      'get_languages',
    );
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
});

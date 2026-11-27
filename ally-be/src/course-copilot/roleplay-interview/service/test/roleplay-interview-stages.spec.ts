import {
  countStageQuestions,
  fieldStageRefusal,
  planRefusal,
  renderRoleplayPilotStage,
  resolveRoleplayPilotStage,
  ROLEPLAY_PILOT_MAX_QUESTIONS,
  roleplayQuestionRefusal,
} from '../../util/roleplay-pilot-stages.util';
import {
  roleplayPilotPosition,
  RoleplayInterviewToolsService,
} from '../roleplay-interview-tools.service';
import { COMPLETE_BRIEF } from './roleplay-interview-fixtures';

const at = (
  brief: any,
  opts: Partial<Parameters<typeof resolveRoleplayPilotStage>[1]> = {},
) =>
  resolveRoleplayPilotStage(brief, {
    clientChosen: true,
    hasPlan: false,
    asked: {},
    ...opts,
  });

describe('resolveRoleplayPilotStage', () => {
  it('walks learners → skill → client → practice → plan as the brief fills', () => {
    expect(at({}).stage.id).toBe('learners');
    expect(at({}).missing).toEqual([
      'who the learners are',
      'what the learner should be able to do',
    ]);
    const learners = {
      learners: COMPLETE_BRIEF.learners,
      goal: COMPLETE_BRIEF.goal,
    };
    expect(at(learners).stage.id).toBe('skill');
    const skill = {
      ...learners,
      competencyIds: COMPLETE_BRIEF.competencyIds,
      competencyNames: COMPLETE_BRIEF.competencyNames,
      mode: 'practice',
    };
    expect(at(skill).stage.id).toBe('client');
    expect(at(COMPLETE_BRIEF).stage.id).toBe('practice');
    expect(at(COMPLETE_BRIEF, { hasPlan: true }).stage.id).toBe('plan');
  });

  it('counts a competency only once the library has named it', () => {
    const brief = {
      ...COMPLETE_BRIEF,
      competencyNames: [],
    };
    expect(at(brief).stage.id).toBe('skill');
  });

  it('holds the client stage until the Character Library rule is met', () => {
    const position = at(COMPLETE_BRIEF, { clientChosen: false });
    expect(position.stage.id).toBe('client');
    expect(position.missing[0]).toMatch(/Character Library searched/);
  });

  it('goes back to an earlier stage when an answer there is cleared, even with a plan', () => {
    const brief = { ...COMPLETE_BRIEF, goal: '' };
    expect(at(brief, { hasPlan: true }).stage.id).toBe('learners');
  });

  it('caps questions per stage and across the interview', () => {
    expect(at({}, { asked: { learners: 1 } }).questionsLeft).toBe(1);
    expect(at({}, { asked: { learners: 2 } }).questionsLeft).toBe(0);
    const nearlyAll = at(COMPLETE_BRIEF, {
      asked: { learners: 2, skill: 2, client: 2, practice: 1 },
    });
    expect(nearlyAll.questionsLeft).toBe(ROLEPLAY_PILOT_MAX_QUESTIONS - 7);
    expect(
      at(COMPLETE_BRIEF, { hasPlan: true, asked: { learners: 9 } })
        .questionsLeft,
    ).toBe(Infinity);
  });
});

describe('roleplayQuestionRefusal and the stage block', () => {
  it('refuses only when the stage is out of questions, and says to use defaults', () => {
    expect(roleplayQuestionRefusal(at({}))).toBeNull();
    const refusal = roleplayQuestionRefusal(at({}, { asked: { learners: 2 } }));
    expect(refusal).toMatch(/2-question limit for "Learners and goal"/);
    expect(refusal).toMatch(/defaults/);
  });

  it('tells the agent the stage, what is missing and that the plan is not open yet', () => {
    const block = renderRoleplayPilotStage(at({}));
    expect(block).toContain(
      '<roleplay_stage id="learners" step="1 of 5" questions_left="2">',
    );
    expect(block).toContain(
      'Still needed before the next stage: who the learners are',
    );
    expect(block).toContain('propose_plan is not available yet');
    expect(
      renderRoleplayPilotStage(at(COMPLETE_BRIEF, { hasPlan: true })),
    ).toContain('questions_left="any"');
  });
});

describe('countStageQuestions', () => {
  it('counts tagged question cards per stage and ignores untagged ones', () => {
    expect(
      countStageQuestions([
        {
          metadata: { questions: [{ stage: 'learners' }, { stage: 'skill' }] },
        },
        { metadata: { questions: [{ stage: 'learners' }, { id: 'old' }] } },
        { metadata: null },
        { metadata: { questions: [{ stage: 'nonsense' }] } },
      ]),
    ).toEqual({ learners: 2, skill: 1 });
  });
});

describe('RoleplayInterviewToolsService with stages', () => {
  const service = new RoleplayInterviewToolsService(
    { update: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const context = (
    brief: any,
    asked: Record<string, number> = {},
    plan: any = null,
  ) =>
    ({
      session: {
        id: 's1',
        brief,
        plan,
        planVersion: plan ? 1 : 0,
        status: 'INTERVIEWING',
      },
      userId: 1,
      changes: { briefFields: new Set(), planVersion: null },
      pilot: { asked },
    }) as any;
  const ask = {
    prompt: 'Who are the learners?',
    kind: 'freeText',
    message: 'Quick one.',
  };

  it('leaves propose_plan off the belt until the stage allows a plan', () => {
    const names = (ctx: any) =>
      service
        .getToolDefinitions(roleplayPilotPosition(ctx))
        .map((tool) => tool.name);
    expect(names(context({}))).not.toContain('propose_plan');
    expect(names(context(COMPLETE_BRIEF))).toContain('propose_plan');
    // Stages off: the belt is as before.
    expect(service.getToolDefinitions().map((tool) => tool.name)).toContain(
      'propose_plan',
    );
  });

  it('tags a question with its stage and counts it', async () => {
    const ctx = context({});
    const out = await service.execute('ask_trainer', ask, ctx);
    expect(out.modelResult.ok).toBe(true);
    expect(out.events?.[0].data.stage).toBe('learners');
    expect(ctx.pilot.asked).toEqual({ learners: 1 });
  });

  it('refuses a question once the stage is out of them', async () => {
    const ctx = context({}, { learners: 2 });
    const out = await service.execute('ask_trainer', ask, ctx);
    expect(out.modelResult).toMatchObject({
      ok: false,
      error: 'question_limit',
    });
    expect(out.events).toBeUndefined();
  });

  it('refuses propose_plan while an earlier stage is open', async () => {
    const out = await service.execute(
      'propose_plan',
      {},
      context({ learners: COMPLETE_BRIEF.learners, goal: COMPLETE_BRIEF.goal }),
    );
    expect(out.modelResult).toMatchObject({
      ok: false,
      error: 'stage_not_ready',
    });
    expect(out.modelResult.message).toMatch(/Competency and mode/);
  });

  it('asks without limits when stages are off', async () => {
    const ctx = { ...context({}, { learners: 5 }), pilot: undefined };
    const out = await service.execute('ask_trainer', ask, ctx);
    expect(out.modelResult.ok).toBe(true);
    expect(out.events?.[0].data.stage).toBeUndefined();
  });
});

describe('practice gate and stage-matched cards', () => {
  const practiceReady = { ...COMPLETE_BRIEF, minScore: 60 };

  it('keeps the plan back until difficulty, language and pass mark are recorded', () => {
    const position = at(COMPLETE_BRIEF);
    expect(position.stage.id).toBe('practice');
    expect(position.missing).toEqual(['the pass mark']);
    expect(planRefusal(position)).toMatch(/record the pass mark first/);
    expect(planRefusal(at(practiceReady))).toBeNull();
    expect(planRefusal(at({}))).toMatch(/Learners and goal/);
  });

  it('refuses a card for a later stage, allows the current and earlier ones', () => {
    const atClient = at({
      learners: COMPLETE_BRIEF.learners,
      goal: COMPLETE_BRIEF.goal,
      competencyIds: COMPLETE_BRIEF.competencyIds,
      competencyNames: COMPLETE_BRIEF.competencyNames,
      mode: 'practice',
    });
    expect(atClient.stage.id).toBe('client');
    expect(fieldStageRefusal(atClient, 'languageIds')).toMatch(
      /languageIds belongs to "Practice details"/,
    );
    expect(fieldStageRefusal(atClient, 'characterId')).toBeNull();
    expect(fieldStageRefusal(atClient, 'mode')).toBeNull();
    expect(fieldStageRefusal(atClient, undefined)).toBeNull();
  });

  it('the tools service refuses an out-of-stage card and an early plan', async () => {
    const service = new RoleplayInterviewToolsService(
      { update: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const ctx = {
      session: {
        id: 's1',
        brief: {},
        plan: null,
        planVersion: 0,
        status: 'INTERVIEWING',
      },
      userId: 1,
      changes: { briefFields: new Set(), planVersion: null },
      pilot: { asked: {} },
    } as any;
    const card = await service.execute(
      'ask_trainer',
      {
        prompt: 'Which language?',
        kind: 'singleSelect',
        field: 'languageIds',
        message: 'Hi.',
      },
      ctx,
    );
    expect(card.modelResult).toMatchObject({
      ok: false,
      error: 'question_out_of_stage',
    });
    ctx.session.brief = COMPLETE_BRIEF;
    const plan = await service.execute('propose_plan', {}, ctx);
    expect(plan.modelResult).toMatchObject({
      ok: false,
      error: 'stage_not_ready',
    });
    expect(plan.modelResult.message).toMatch(/pass mark/);
  });
});

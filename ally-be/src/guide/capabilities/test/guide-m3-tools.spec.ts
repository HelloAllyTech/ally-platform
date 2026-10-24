import { SessionItemStatus } from 'src/common/type/common.type';
import {
  QuizQuestionType,
  QuizShowExplanations,
} from 'src/track/type/quiz.type';
import { TrackItemType } from 'src/track/type/track.type';
import { buildCourseSpine } from '../../conductor/course-spine';
import { GuideMemoryKind, GuideMode } from '../../enum/guide.enum';
import { GUIDE_DEFAULT_BUNDLE } from '../../release/guide-release.bundle';
import { GuideToolExecutorService } from '../guide-tool-executor.service';
import {
  GUIDE_DEFERRABLE_TOOLS,
  GUIDE_LEARNER_TOOLS,
  GUIDE_TOOLS,
  GUIDE_TOOL_NAMES,
  GUIDE_TOOL_SEARCH_THRESHOLD,
  GUIDE_VISITOR_TOOLS,
  withToolSearch,
} from '../guide-tools';
import { GuideAssessorService } from '../specialists/guide-assessor.service';
import {
  GuideCoachService,
  mentionsScore,
} from '../specialists/guide-coach.service';

/**
 * Ally's M3 tools (plans/ally-guide/plan.md §4.4, §4.9, §6.4, §7.6, §7.7):
 * consult_coach, consult_assessor, get_peer_signals, search_library and
 * load_skill, through the executor the orchestrator calls.
 */

const spine = buildCourseSpine({
  id: 'tr1',
  title: 'Course',
  enrolled: true,
  sections: [
    {
      id: 's1',
      title: 'First calls',
      order: 1,
      items: [
        {
          id: 'art',
          type: TrackItemType.ARTICLE,
          order: 1,
          title: 'Silence',
          status: SessionItemStatus.COMPLETED,
        },
        {
          id: 'rp',
          type: TrackItemType.ROLEPLAY,
          order: 2,
          title: 'Meera calls',
          description: 'A caller who goes quiet.',
          status: SessionItemStatus.COMPLETED,
        },
        {
          id: 'quiz',
          type: TrackItemType.QUIZ,
          order: 3,
          title: 'Check',
          status: SessionItemStatus.UNLOCKED,
        },
        {
          id: 'case',
          type: TrackItemType.CASE,
          order: 4,
          title: 'Later case',
          status: SessionItemStatus.LOCKED,
        },
      ],
    },
  ],
} as never);

const HIDDEN_ANSWER = 'Name the feeling you hear before anything else';
const NEVER_EXPLANATION = 'Silence gives the caller room to find words.';

function setup(
  overrides: Record<string, unknown> = {},
  deps: {
    coachModel?: (call: any) => unknown;
    showExplanations?: QuizShowExplanations;
    history?: unknown[];
    library?: { search: jest.Mock };
    peer?: Record<string, jest.Mock>;
  } = {},
) {
  const modelCalls: any[] = [];
  const models = {
    complete: jest.fn(async (call: any) => {
      modelCalls.push(call);
      return {
        result: {
          stopReason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                deps.coachModel?.(call) ?? {
                  explanation: 'About question 1.',
                  questions: [1],
                },
              ),
            },
          ],
        },
      };
    }),
  };
  const coach = new GuideCoachService(models as never);
  const assessor = new GuideAssessorService(
    models as never,
    {
      quizWithKey: jest.fn(async () => ({
        title: 'Check',
        quiz: {
          settings: {
            passScore: 70,
            showExplanations:
              deps.showExplanations ?? QuizShowExplanations.NEVER,
          },
          questions: [
            {
              id: 'q1',
              type: QuizQuestionType.MCQ_SINGLE,
              prompt: 'What comes first?',
              explanation: NEVER_EXPLANATION,
              showCorrectAnswer: false,
              options: [
                { id: 'a', text: HIDDEN_ANSWER },
                { id: 'b', text: 'Ask for their whole history first' },
              ],
              correctOptionIds: ['a'],
            },
          ],
        },
      })),
    } as never,
    {
      query: jest.fn(async () => [
        {
          attemptNumber: 2,
          answers: [{ questionId: 'q1', selectedOptionIds: ['b'] }],
          grading: [
            {
              questionId: 'q1',
              correct: false,
              pointsAwarded: 0,
              pointsPossible: 1,
            },
          ],
        },
      ]),
    } as never,
  );
  const practice = {
    recent: jest.fn(async () => deps.history ?? []),
  };
  const learnerData = {
    activeMemories: jest.fn(async () => [
      { kind: GuideMemoryKind.GOAL, body: 'Feel calmer opening calls.' },
      { kind: GuideMemoryKind.PREFERENCE, body: 'Prefers short replies.' },
    ]),
  };
  const peer = {
    itemSignals: jest.fn(async () => [
      {
        itemId: 'rp',
        phrases: ['Many learners take more than one go at this.'],
      },
    ]),
    visibleAdvice: jest.fn(async () => ['Breathe <b>first</b>.']),
    ...(deps.peer ?? {}),
  };
  const library = deps.library ?? {
    search: jest.fn(async () => []),
  };
  const executor = new GuideToolExecutorService(
    {} as never,
    {} as never,
    {} as never,
    learnerData as never,
    {} as never,
    coach,
    assessor,
    practice as never,
    peer as never,
    library as never,
  );
  const ctx: any = {
    threadId: 'th1',
    turnId: 't1',
    userId: 3,
    tenantId: 'org-1',
    trackId: 'tr1',
    language: 'en',
    mode: GuideMode.NORMAL,
    overlay: 'none',
    memoryEnabled: true,
    bundle: GUIDE_DEFAULT_BUNDLE,
    spine,
    pacing: {},
    presented: [],
    epochNumber: 2,
    learnerTexts: [],
    attribution: {},
    openItemId: null,
    emitDurable: jest.fn(async () => 1),
    ...overrides,
  };
  return { executor, ctx, modelCalls, practice, peer, library, learnerData };
}

const run = async (
  t: ReturnType<typeof setup>,
  name: string,
  input: Record<string, unknown>,
) => {
  const result = await t.executor.execute(name, input, t.ctx);
  return { ...result, body: JSON.parse(result.content) };
};

describe('consult_assessor: nothing of the key reaches the orchestrator', () => {
  it('`never`: points to the material and returns no explanation or answer', async () => {
    const t = setup();
    const result = await run(t, 'consult_assessor', {
      item_id: 'quiz',
      question: 'Which one was right?',
    });
    expect(result.isError).toBe(false);
    expect(result.body).toMatchObject({
      mayExplain: false,
      coveredIn: ['Silence', 'Meera calls'],
    });
    expect(result.content).not.toContain(HIDDEN_ANSWER);
    expect(result.content).not.toContain(NEVER_EXPLANATION);
    expect(t.modelCalls).toHaveLength(0);
  });

  it('after_submit, answer hidden by the question: the Assessor never sees it, and neither does the tool result', async () => {
    const t = setup(
      {},
      { showExplanations: QuizShowExplanations.AFTER_SUBMIT },
    );
    const result = await run(t, 'consult_assessor', {
      item_id: 'quiz',
      question: 'Why was I wrong?',
    });
    expect(result.body).toMatchObject({ mayExplain: true, attempt: 2 });
    expect(JSON.stringify(t.modelCalls[0].request)).not.toContain(
      HIDDEN_ANSWER,
    );
    expect(result.content).not.toContain(HIDDEN_ANSWER);
  });

  it('only points while the quiz is open on screen', async () => {
    const t = setup(
      { openItemId: 'quiz' },
      { showExplanations: QuizShowExplanations.AFTER_EACH },
    );
    const result = await run(t, 'consult_assessor', {
      item_id: 'quiz',
      question: 'Is it the first one?',
    });
    expect(result.body.mayExplain).toBe(false);
    expect(t.modelCalls).toHaveLength(0);
  });

  it('refuses a non-quiz item', async () => {
    const t = setup();
    const result = await run(t, 'consult_assessor', {
      item_id: 'art',
      question: 'x',
    });
    expect(result.isError).toBe(true);
  });
});

describe('consult_coach', () => {
  const attempt = {
    scenarioSessionId: 's1',
    trackItemId: 'rp',
    endedAt: '2026-10-20T10:00:00.000Z',
    score: 62,
    positives: ['You let a silence sit.'],
    growth: [
      { improvement: 'Reassured early', recommendation: 'Reflect first' },
    ],
    note: 'A steady call.',
  };

  it('pre-briefs from the practice history and the learner goals', async () => {
    const t = setup(
      {},
      {
        history: [attempt],
        coachModel: () => ({
          focus: 'Reflect before you reassure.',
          brief: 'This caller needs room.',
          rehearsal: 'Want to try your opening line?',
        }),
      },
    );
    const result = await run(t, 'consult_coach', {
      purpose: 'prebrief',
      item_id: 'rp',
      learner_noticed: null,
    });
    expect(result.body).toMatchObject({
      purpose: 'prebrief',
      focus: 'Reflect before you reassure.',
      rehearsalOffer: 'Want to try your opening line?',
      firstTime: false,
    });
    const sent = t.modelCalls[0].request.messages[0].content as string;
    expect(sent).toContain('<job>prebrief</job>');
    expect(sent).toContain('Reassured early');
    expect(sent).toContain('Feel calmer opening calls.');
    expect(sent).not.toContain('Prefers short replies.');
  });

  it('never passes on a line that reports a score', async () => {
    const t = setup(
      {},
      {
        history: [attempt],
        coachModel: () => ({
          what_happened: 'You scored 62% on this one.',
          why: 'Reassurance came before reflection.',
          try_next: 'Reflect the feeling first.',
        }),
      },
    );
    const result = await run(t, 'consult_coach', {
      purpose: 'after_action',
      item_id: 'rp',
      learner_noticed: 'I rushed.',
    });
    expect(result.body.whatHappened).toBe('');
    expect(result.body.tryNext).toBe('Reflect the feeling first.');
    expect(result.content).not.toMatch(/62/);
    const sent = t.modelCalls[0].request.messages[0].content as string;
    expect(sent).toContain('<learner_noticed>I rushed.</learner_noticed>');
  });

  it('waits for the practice to end, and for a care moment to pass', async () => {
    const open = setup({ openItemId: 'rp' }, { history: [attempt] });
    expect(
      (
        await run(open, 'consult_coach', {
          purpose: 'after_action',
          item_id: 'rp',
          learner_noticed: null,
        })
      ).isError,
    ).toBe(true);
    const care = setup({ mode: GuideMode.CARE });
    expect(
      (
        await run(care, 'consult_coach', {
          purpose: 'prebrief',
          item_id: 'rp',
          learner_noticed: null,
        })
      ).isError,
    ).toBe(true);
    expect(open.modelCalls.length + care.modelCalls.length).toBe(0);
  });

  it('covers roleplays and cases only, reached ones, with something to review', async () => {
    const t = setup();
    for (const input of [
      { purpose: 'prebrief', item_id: 'quiz', learner_noticed: null },
      { purpose: 'prebrief', item_id: 'case', learner_noticed: null },
      { purpose: 'after_action', item_id: 'rp', learner_noticed: null },
    ]) {
      expect((await run(t, 'consult_coach', input)).isError).toBe(true);
    }
    expect(t.modelCalls).toHaveLength(0);
  });

  it('recognises scores in text', () => {
    expect(mentionsScore('You got 70%')).toBe(true);
    expect(mentionsScore('8/10 this time')).toBe(true);
    expect(mentionsScore('You scored 60 here')).toBe(true);
    expect(mentionsScore('Try one open question in the first 2 minutes')).toBe(
      false,
    );
  });
});

describe('get_peer_signals', () => {
  it('returns group patterns and quoted, anonymous advice from the same organisation', async () => {
    const t = setup();
    const result = await run(t, 'get_peer_signals', { item_id: 'rp' });
    expect(t.peer.itemSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        trackItemIds: ['rp'],
        tenantId: 'org-1',
        excludeUserId: 3,
        policy: expect.objectContaining({ minGroupSize: 5 }),
      }),
    );
    expect(result.body.patterns).toEqual([
      'Many learners take more than one go at this.',
    ]);
    // Rendered as quoted data: no markup survives.
    expect(result.body.advice.lines).toEqual(['"Breathe ‹b›first‹/b›."']);
    expect(result.content).not.toMatch(/userId|learners":/);
  });

  it('says there is nothing when there is nothing', async () => {
    const t = setup(
      {},
      {
        peer: {
          itemSignals: jest.fn(async () => []),
          visibleAdvice: jest.fn(async () => []),
        },
      },
    );
    const result = await run(t, 'get_peer_signals', { item_id: null });
    expect(result.body).toMatchObject({ patterns: [], advice: null });
    expect(result.body.next).toMatch(/Do not invent/);
  });
});

describe('search_library', () => {
  const hit = (scope: 'global' | 'organisation') => ({
    documentId: 'd1',
    title: scope === 'global' ? 'After a hard shift' : 'Our escalation route',
    text: 'Take five minutes <i>before</i> the next call.',
    similarity: 0.8,
    scope,
  });

  it("searches the learner's organisation and the global library", async () => {
    const library = {
      search: jest.fn(async () => [hit('organisation'), hit('global')]),
    };
    const t = setup({}, { library });
    const result = await run(t, 'search_library', { query: 'hard shift' });
    expect(library.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'hard shift',
        tenantId: 'org-1',
        userId: 3,
        threadId: 'th1',
      }),
    );
    expect(result.body.found).toBe(true);
    expect(result.body.passages.map((p: any) => [p.title, p.from])).toEqual([
      ['Our escalation route', 'their organisation'],
      ['After a hard shift', 'Ally library'],
    ]);
    expect(result.body.passages[0].text).not.toContain('<i>');
  });

  it('a visitor searches the global library only', async () => {
    const library = { search: jest.fn(async () => [hit('global')]) };
    const t = setup({ anonymous: true, tenantId: '' }, { library });
    const result = await run(t, 'search_library', { query: 'burnout' });
    expect(result.isError).toBe(false);
    expect(library.search).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, userId: null }),
    );
  });

  it('tells "unavailable" from "nothing found"', async () => {
    const down = setup(
      {},
      {
        library: {
          search: jest.fn(async () => {
            throw new Error('weaviate down');
          }),
        },
      },
    );
    const unavailable = await run(down, 'search_library', { query: 'x y' });
    expect(unavailable.isError).toBe(true);
    expect(unavailable.body.error).toMatch(/unavailable/);

    const empty = setup({}, { library: { search: jest.fn(async () => []) } });
    const nothing = await run(empty, 'search_library', { query: 'x y' });
    expect(nothing.isError).toBe(false);
    expect(nothing.body).toMatchObject({ found: false });
    expect(nothing.body.next).toMatch(/nothing on this/);
  });

  it('is on the visitor tool list', () => {
    expect(GUIDE_VISITOR_TOOLS.map((tool) => tool.name)).toContain(
      GUIDE_TOOL_NAMES.SEARCH_LIBRARY,
    );
  });
});

describe('load_skill', () => {
  it("appends the skill's instructions once per epoch", async () => {
    const t = setup();
    const first = await run(t, 'load_skill', {
      skill_id: 'debrief-heavy-roleplay',
    });
    expect(first.body.instructions).toMatch(/Arrive first/);
    expect(t.ctx.pacing.skillsLoaded).toEqual({
      epoch: 2,
      ids: ['debrief-heavy-roleplay'],
    });
    const again = await run(t, 'load_skill', {
      skill_id: 'debrief-heavy-roleplay',
    });
    expect(again.body).toMatchObject({ alreadyLoaded: true });
    expect(again.body.instructions).toBeUndefined();
  });

  it('refuses a skill the release does not enable', async () => {
    const t = setup({
      bundle: { ...GUIDE_DEFAULT_BUNDLE, skills: {} },
    });
    expect(
      (await run(t, 'load_skill', { skill_id: 'org-protocol' })).isError,
    ).toBe(true);
  });
});

describe('tool search', () => {
  it('defers the occasional tools once there are more than 15', () => {
    expect(GUIDE_TOOLS.length).toBeGreaterThan(GUIDE_TOOL_SEARCH_THRESHOLD);
    const deferred = GUIDE_LEARNER_TOOLS.filter((tool) => tool.deferLoading);
    expect(deferred.map((tool) => tool.name).sort()).toEqual(
      [...GUIDE_DEFERRABLE_TOOLS].sort(),
    );
  });

  it('never defers the safety path, presenting, or the Tutor', () => {
    for (const name of [
      GUIDE_TOOL_NAMES.SHOW_WELLBEING_RESOURCES,
      GUIDE_TOOL_NAMES.PRESENT_COURSE_ITEM,
      GUIDE_TOOL_NAMES.CONSULT_TUTOR,
      GUIDE_TOOL_NAMES.LOAD_SKILL,
    ]) {
      expect(GUIDE_DEFERRABLE_TOOLS.has(name)).toBe(false);
    }
  });

  it('defers nothing at or under the threshold', () => {
    const few = GUIDE_TOOLS.slice(0, GUIDE_TOOL_SEARCH_THRESHOLD);
    expect(withToolSearch(few).some((tool) => tool.deferLoading)).toBe(false);
    expect(GUIDE_VISITOR_TOOLS.some((tool) => tool.deferLoading)).toBe(false);
  });
});

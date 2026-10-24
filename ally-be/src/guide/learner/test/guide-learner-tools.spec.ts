import { BadRequestException } from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from 'src/track/type/track.type';
import { buildCourseSpine } from '../../conductor/course-spine';
import {
  GuideToolExecutorService,
  isGroundedInLearnerWords,
  isLearnersOwnWords,
} from '../../capabilities/guide-tool-executor.service';
import { verifyTutorAnswer } from '../../capabilities/specialists/guide-tutor.service';
import { learnerSafeText } from '../../content/guide-course-content.service';
import { GuideMemoryStatus, GuideMode } from '../../enum/guide.enum';
import { GUIDE_DEFAULT_BUNDLE } from '../../release/guide-release.bundle';
import {
  GuideLearnerDataService,
  isValidTimezone,
  renderNotebookMarkdown,
} from '../guide-learner-data.service';

describe('learnerSafeText (the Tutor firewall)', () => {
  it('reads an article body but never its inline questions', () => {
    const text = learnerSafeText({
      type: TrackItemType.ARTICLE,
      description: 'About silence',
      content: {
        html: '<p>Silence gives space.</p>',
        questions: [{ prompt: 'Q?', options: [{ text: 'A', correct: true }] }],
      },
    } as never);
    expect(text).toContain('Silence gives space.');
    expect(text).not.toContain('correct');
    expect(text).not.toContain('Q?');
  });

  it('gives a quiz, video or branching scenario its description only', () => {
    for (const type of [
      TrackItemType.QUIZ,
      TrackItemType.VIDEO,
      TrackItemType.BRANCHING_SCENARIO,
    ]) {
      expect(
        learnerSafeText({
          type,
          description: 'Overview',
          content: {
            questions: [{ correctOptionId: 'x' }],
            interjections: [{}],
            nodes: [{}],
          },
        } as never),
      ).toBe('Overview');
    }
  });

  it('names a sort’s categories but not which item goes where', () => {
    const text = learnerSafeText({
      type: TrackItemType.BUCKET_SORT,
      content: {
        intro: 'Sort these',
        buckets: [{ id: 'b1', label: 'Reflection' }],
        items: [{ text: 'It sounds hard', bucketId: 'b1' }],
      },
    } as never);
    expect(text).toContain('Categories: Reflection');
    expect(text).not.toContain('It sounds hard');
  });
});

describe('verifyTutorAnswer', () => {
  const sources = [
    {
      itemId: 'i1',
      title: 'Silence',
      type: 'article',
      text: 'Silence gives the caller space to go on.',
    },
  ];

  it('keeps a citation whose quote is really in the passage', () => {
    expect(
      verifyTutorAnswer(
        {
          covered: true,
          answer: 'Silence gives space.',
          citations: [{ itemId: 'i1', quote: 'gives the caller space' }],
        },
        sources,
      ),
    ).toEqual({
      covered: true,
      answer: 'Silence gives space.',
      citations: [
        { itemId: 'i1', title: 'Silence', quote: 'gives the caller space' },
      ],
    });
  });

  it('reports an answer whose citations do not check out as not covered', () => {
    expect(
      verifyTutorAnswer(
        {
          covered: true,
          answer: 'Invented.',
          citations: [{ itemId: 'i1', quote: 'never said this' }],
        },
        sources,
      ),
    ).toEqual({ covered: false, answer: '', citations: [] });
  });
});

describe('GuideLearnerDataService', () => {
  function setup(existing: any = null) {
    const memories = {
      findOne: jest.fn(async () => existing),
      find: jest.fn(async () => []),
      update: jest.fn(async () => undefined),
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({ id: 'm1', ...row })),
    };
    const appointments = {
      update: jest.fn(async () => undefined),
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({ id: 'a1', ...row })),
      findOne: jest.fn(),
    };
    const service = new GuideLearnerDataService(
      memories as never,
      {} as never,
      appointments as never,
    );
    return { service, memories, appointments };
  }
  const owner = { id: 3, tenantId: 'org' };
  const input = (body: string) => ({
    owner,
    kind: 'goal' as never,
    body,
    threadId: 'th1',
    expiryDays: 180,
    maxChars: 280,
  });

  it('stores a new note with an expiry', async () => {
    const t = setup();
    expect(await t.service.remember(input('Wants calmer openings.'))).toEqual({
      stored: true,
      id: 'm1',
      updated: false,
    });
    expect(t.memories.save.mock.calls[0][0]).toMatchObject({
      body: 'Wants calmer openings.',
      revision: 1,
    });
  });

  it('confirms a note it already holds instead of duplicating it', async () => {
    const t = setup({
      id: 'm9',
      status: GuideMemoryStatus.ACTIVE,
      revision: 2,
    });
    expect(await t.service.remember(input('wants CALMER openings!'))).toEqual({
      stored: true,
      id: 'm9',
      updated: true,
    });
    expect(t.memories.save).not.toHaveBeenCalled();
  });

  it('never brings back a note the learner asked to forget', async () => {
    const t = setup({ id: 'm9', status: GuideMemoryStatus.DELETED });
    expect(await t.service.remember(input('Wants calmer openings.'))).toEqual({
      stored: false,
      reason: 'forgotten_before',
    });
  });

  it('forgets by dropping the text at once', async () => {
    const t = setup({ id: 'm9', status: GuideMemoryStatus.ACTIVE });
    await t.service.forgetMemory(owner, 'm9');
    expect(t.memories.update).toHaveBeenCalledWith('m9', {
      status: GuideMemoryStatus.DELETED,
      body: '',
      expiresAt: null,
    });
  });

  it.each([
    ['not-a-date', 'Asia/Kolkata'],
    ['2026-10-23T12:01:00Z', 'Asia/Kolkata'],
    ['2026-12-30T12:00:00Z', 'Asia/Kolkata'],
    ['2026-10-24T12:00:00Z', 'Mars/Olympus'],
  ])('refuses appointment %s in %s', async (at, timezone) => {
    const t = setup();
    await expect(
      t.service.setAppointment(
        { id: 'th1' } as never,
        owner,
        { at, timezone },
        new Date('2026-10-23T12:00:00Z'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replaces the previous appointment with the new one', async () => {
    const t = setup();
    const result = await t.service.setAppointment(
      { id: 'th1' } as never,
      owner,
      { at: '2026-10-24T03:30:00Z', timezone: 'Asia/Kolkata' },
      new Date('2026-10-23T12:00:00Z'),
    );
    expect(t.appointments.update).toHaveBeenCalledWith(
      { threadId: 'th1', status: 'scheduled' },
      { status: 'cancelled' },
    );
    expect(result).toMatchObject({
      at: '2026-10-24T03:30:00.000Z',
      status: 'scheduled',
    });
  });

  it('validates time zones and renders the notebook as Markdown', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('Nowhere/Land')).toBe(false);
    expect(
      renderNotebookMarkdown([
        { kind: 'possible_self', text: 'Someone people feel safe with.' },
        {
          kind: 'noticing',
          text: 'You asked about the plan directly (roleplay)',
        },
      ] as never),
    ).toBe(
      [
        '# My notebook',
        '',
        '## The helper I want to become',
        '',
        '- Someone people feel safe with.',
        '',
        '## Moments Ally noticed',
        '',
        '- You asked about the plan directly (roleplay)',
        '',
      ].join('\n'),
    );
  });
});

describe('learner tools', () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const learnerData = {
      remember: jest.fn(async () => ({
        stored: true,
        id: 'm1',
        updated: false,
      })),
      addToNotebook: jest.fn(async (input: any) => ({ id: 'n1', ...input })),
    };
    const cards = {
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({ id: 'c1', ...row })),
      update: jest.fn(),
      query: jest.fn(async (): Promise<unknown[]> => []),
    };
    const executor = new GuideToolExecutorService(
      cards as never,
      {} as never,
      { consult: jest.fn() } as never,
      learnerData as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const emitted: string[] = [];
    const ctx: any = {
      threadId: 'th1',
      turnId: 't1',
      userId: 3,
      tenantId: 'org',
      trackId: 'tr1',
      mode: GuideMode.NORMAL,
      overlay: 'none',
      memoryEnabled: true,
      bundle: GUIDE_DEFAULT_BUNDLE,
      pacing: {},
      presented: [],
      epochNumber: 2,
      learnerTexts: [
        'I want to be someone people feel safe talking to at 3am.',
      ],
      emitDurable: jest.fn(async (type: string) => {
        emitted.push(type);
        return 1;
      }),
      ...overrides,
    };
    return { executor, ctx, learnerData, emitted, cards };
  }

  it('remembers only when memory is on and the moment is ordinary', async () => {
    const off = setup({ memoryEnabled: false });
    expect(
      (
        await off.executor.execute(
          'remember',
          { kind: 'goal', note: 'x' },
          off.ctx,
        )
      ).isError,
    ).toBe(true);
    const care = setup({ mode: GuideMode.CARE });
    expect(
      (
        await care.executor.execute(
          'remember',
          { kind: 'goal', note: 'x' },
          care.ctx,
        )
      ).isError,
    ).toBe(true);
    const realCase = setup({ overlay: 'real_case' });
    expect(
      (
        await realCase.executor.execute(
          'remember',
          { kind: 'goal', note: 'x' },
          realCase.ctx,
        )
      ).isError,
    ).toBe(true);
    const ok = setup();
    expect(
      (
        await ok.executor.execute(
          'remember',
          { kind: 'goal', note: 'Wants people to feel safe talking at 3am.' },
          ok.ctx,
        )
      ).isError,
    ).toBe(false);
  });

  it('never remembers what the learner did not say', async () => {
    // A trigger turn asked a question and stored its own answer (1.5 walk).
    const invented = setup();
    const result = await invented.executor.execute(
      'remember',
      {
        kind: 'possible_self',
        note: 'A calm listener who helps people find small next steps.',
      },
      invented.ctx,
    );
    expect(result.isError).toBe(true);
    expect(invented.learnerData.remember).not.toHaveBeenCalled();

    const platform = setup({ platformTurn: true });
    expect(
      (
        await platform.executor.execute(
          'remember',
          {
            kind: 'possible_self',
            note: 'Wants people to feel safe talking at 3am.',
          },
          platform.ctx,
        )
      ).isError,
    ).toBe(true);
  });

  it('isGroundedInLearnerWords allows a paraphrase but not an invention', () => {
    const said = [
      'I think I rushed to fill the silence. Next time I want to let it breathe.',
    ];
    expect(
      isGroundedInLearnerWords(
        'Wants to let silence breathe instead of rushing to fill it.',
        said,
      ),
    ).toBe(true);
    expect(
      isGroundedInLearnerWords('Prefers detailed written feedback.', said),
    ).toBe(false);
    expect(isGroundedInLearnerWords('', said)).toBe(false);
    // Another script cannot be judged word by word; other guards still hold.
    expect(
      isGroundedInLearnerWords('Wants to slow down in silences.', [
        'मैं चुप्पी में जल्दी बोल देती हूँ',
      ]),
    ).toBe(true);
  });

  it('saves only the learner’s own words to the notebook', async () => {
    const t = setup();
    expect(
      (
        await t.executor.execute(
          'save_to_notebook',
          { kind: 'possible_self', text: 'Someone I invented for them.' },
          t.ctx,
        )
      ).isError,
    ).toBe(true);
    const saved = await t.executor.execute(
      'save_to_notebook',
      {
        kind: 'possible_self',
        text: 'someone people feel safe talking to at 3am',
      },
      t.ctx,
    );
    expect(saved.isError).toBe(false);
    expect(t.emitted).toEqual(['notebook.added']);
  });

  it('keeps noticing rare: twice a session', async () => {
    const t = setup();
    const notice = () =>
      t.executor.execute(
        'record_noticing',
        { behaviour: 'You asked about her plan directly', evidence: 'debrief' },
        t.ctx,
      );
    expect((await notice()).isError).toBe(false);
    expect((await notice()).isError).toBe(false);
    expect((await notice()).isError).toBe(true);
    expect(t.ctx.pacing.noticing).toEqual({ epoch: 2, count: 2 });
  });

  it('shows the closing card once a session', async () => {
    const t = setup();
    const close = () =>
      t.executor.execute(
        'close_session',
        {
          noticing: 'You stayed with silence.',
          watch_for: 'Reflect first.',
          teaser: 'Next: a quiet caller.',
        },
        t.ctx,
      );
    expect((await close()).isError).toBe(false);
    expect(t.ctx.presented[0]).toMatchObject({
      kind: 'closing_ritual',
      presentation: 'inline',
    });
    expect((await close()).isError).toBe(true);
  });

  it('points to a step already on screen instead of stacking a duplicate card', async () => {
    const spine = buildCourseSpine({
      id: 'tr1',
      title: 'Course',
      enrolled: true,
      sections: [
        {
          id: 's1',
          title: 'Start',
          order: 1,
          items: [
            {
              id: 'i1',
              type: TrackItemType.ARTICLE,
              order: 1,
              title: 'Welcome',
              status: SessionItemStatus.UNLOCKED,
            },
          ],
        },
      ],
    });
    const steer = {
      level: 3,
      reason: 'learner asked to continue',
      dockVisible: true,
      mayPresentNext: true,
    };
    const input = { item_id: 'i1', reason: 'next_step', framing: 'Read this' };

    const first = setup({
      spine,
      steer,
      epochStartedAt: '2026-10-23T17:00:00.000Z',
    });
    const presented = JSON.parse(
      (await first.executor.execute('present_course_item', input, first.ctx))
        .content,
    );
    expect(presented.presented).toBe(true);
    expect(first.emitted).toEqual(['card.presented']);

    const again = setup({
      spine,
      steer,
      epochStartedAt: '2026-10-23T17:00:00.000Z',
    });
    again.cards.query.mockResolvedValue([{ id: 'c0', state: 'ready' }]);
    const result = await again.executor.execute(
      'present_course_item',
      input,
      again.ctx,
    );
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      presented: false,
      alreadyOnScreen: true,
    });
    expect(again.emitted).toEqual([]);
    expect(again.cards.save).not.toHaveBeenCalled();
  });

  it('isLearnersOwnWords needs a real phrase, not a word', () => {
    expect(isLearnersOwnWords('safe', ['I feel safe'])).toBe(false);
    expect(isLearnersOwnWords('“Feel SAFE”', ['I feel safe here'])).toBe(true);
  });
});

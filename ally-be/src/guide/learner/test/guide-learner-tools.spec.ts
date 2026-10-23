import { BadRequestException } from '@nestjs/common';
import { TrackItemType } from 'src/track/type/track.type';
import {
  GuideToolExecutorService,
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
    };
    const executor = new GuideToolExecutorService(
      cards as never,
      {} as never,
      { consult: jest.fn() } as never,
      learnerData as never,
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
    return { executor, ctx, learnerData, emitted };
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
          { kind: 'goal', note: 'Calmer openings.' },
          ok.ctx,
        )
      ).isError,
    ).toBe(false);
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

  it('isLearnersOwnWords needs a real phrase, not a word', () => {
    expect(isLearnersOwnWords('safe', ['I feel safe'])).toBe(false);
    expect(isLearnersOwnWords('“Feel SAFE”', ['I feel safe here'])).toBe(true);
  });
});

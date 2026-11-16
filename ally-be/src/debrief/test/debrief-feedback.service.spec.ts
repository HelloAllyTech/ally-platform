import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  DebriefFeedbackService,
  FLAG_UNDO_MS,
  sectionText,
} from '../service/debrief-feedback.service';
import { DebriefCards } from '../util/debrief-cards.util';

const cards: DebriefCards = {
  opening: 'Opening.',
  important_moment: {
    turn_index: 2,
    quote: 'No point',
    handled_well: false,
    lead: 'Lead',
    body: 'Body',
  },
  what_worked: [
    { skill: 'a', turn_index: 1, quote: 'q1', lead: 'Worked 0', body: 'b' },
    { skill: 'b', turn_index: 3, quote: 'q3', lead: 'Worked 1', body: 'b' },
  ],
  work_on_this: [
    {
      skill: 'c',
      turn_index: 3,
      quote: 'q3',
      lead: 'Grow 0',
      why: 'w',
      try_saying: 't',
    },
  ],
  practise_next: { skill: 's', reason: 'r' },
  skill_words: [],
  reflective_question: 'Q?',
};

function build(
  opts: {
    owner?: number;
    run?: Record<string, unknown> | null;
    existing?: Record<string, unknown> | null;
  } = {},
) {
  const saved: any[] = [];
  const run =
    opts.run === null
      ? null
      : {
          id: 'run-1',
          tenantId: 't',
          mode: 'live',
          status: 'published',
          cards,
          workspace: {},
          ...(opts.run ?? {}),
        };
  const dataSource = {
    query: jest.fn(async () => [{ counselor_id: opts.owner ?? 7 }]),
  };
  const runs = { findOne: jest.fn(async () => run), update: jest.fn() };
  const feedback = {
    findOne: jest.fn(async () => opts.existing ?? null),
    find: jest.fn(async () => []),
    create: (x: any) => ({ ...x }),
    save: jest.fn(async (x: any) => {
      saved.push(x);
      return { id: 'f1', updatedAt: new Date(), ...x };
    }),
  };
  return {
    svc: new DebriefFeedbackService(
      dataSource as any,
      runs as any,
      feedback as any,
    ),
    saved,
    runs,
  };
}

describe('debrief feedback', () => {
  it('names the card a section points at, and nothing for one that is not there', () => {
    expect(sectionText(cards, 'what_worked[1]')).toContain('Worked 1');
    expect(sectionText(cards, 'work_on_this[0]')).toContain('t');
    expect(sectionText(cards, 'what_worked[5]')).toBeNull();
    expect(sectionText(cards, 'nonsense')).toBeNull();
  });

  it('reads the progress card focus first, then each skill line', () => {
    const withCard = {
      ...cards,
      progress_card: {
        sessions: 5,
        skills: [
          { skill: 'empathy', trend: 'more_consistent', line: 'Skill line.' },
          { skill: 'listening', trend: 'about_the_same', line: '' },
        ],
        focus: { skill: 'empathy', line: 'Focus line.' },
      },
    } as any;
    expect(sectionText(withCard, 'progress_card')).toBe(
      'Focus line. Skill line.',
    );
    expect(sectionText(cards, 'progress_card')).toBeNull();
    expect(
      sectionText(
        { ...cards, progress_card: { sessions: 5, skills: [] } } as any,
        'progress_card',
      ),
    ).toBeNull();
  });

  it('only the learner who did the session can flag it', async () => {
    await expect(
      build({ owner: 9 }).svc.flag('s', 7, {
        section: 'opening',
        reason: 'something_else' as any,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a flag on the important moment is urgent; a card that is not there is refused', async () => {
    const { svc, saved } = build();
    await svc.flag('s', 7, {
      section: 'important_moment',
      reason: 'described_wrongly' as any,
    });
    expect(saved[0]).toMatchObject({
      urgent: true,
      status: 'open',
      section: 'important_moment',
    });
    await expect(
      svc.flag('s', 7, {
        section: 'what_worked[2]',
        reason: 'didnt_say' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('one flag per card, and undo only inside the window', async () => {
    await expect(
      build({ existing: { status: 'open' } }).svc.flag('s', 7, {
        section: 'opening',
        reason: 'didnt_say' as any,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const old = new Date(Date.now() - FLAG_UNDO_MS - 1000);
    await expect(
      build({
        existing: {
          id: 'f',
          scenarioSessionId: 's',
          status: 'open',
          updatedAt: old,
        },
      }).svc.undoFlag('s', 7, 'f'),
    ).rejects.toBeInstanceOf(ConflictException);
    const { svc, saved } = build({
      existing: {
        id: 'f',
        scenarioSessionId: 's',
        status: 'open',
        updatedAt: new Date(),
      },
    });
    await svc.undoFlag('s', 7, 'f');
    expect(saved[0].status).toBe('withdrawn');
  });

  it("never shows the learner the team's Ask Ally distress item or its note", async () => {
    const { svc } = build();
    const at = new Date();
    (svc as any).feedback.find = jest.fn(async () => [
      {
        id: 'd1',
        runId: 'run-1',
        userId: 7,
        kind: 'flag',
        section: 'ask_ally',
        status: 'kept',
        resolutionNote: 'Called their supervisor',
        updatedAt: at,
        resolvedAt: at,
      },
      {
        id: 'f2',
        runId: 'run-1',
        userId: 7,
        kind: 'flag',
        section: 'what_worked[0]',
        status: 'kept',
        resolutionNote: 'It stays',
        updatedAt: at,
        resolvedAt: at,
      },
    ]);
    (svc as any).runCorrections = jest.fn(async () => []);
    const view: any = await svc.decorate(
      { state: 'ready', runId: 'run-1', cards } as any,
      7,
    );
    expect(view.corrections).toEqual([
      expect.objectContaining({ section: 'what_worked[0]', note: 'It stays' }),
    ]);
    expect(view.feedback.flags.map((f: any) => f.id)).toEqual(['f2']);
  });

  it('keeping a point needs a reason the learner can read', async () => {
    const { svc } = build({
      existing: { id: 'f', kind: 'flag', status: 'open' },
    });
    await expect(svc.resolveFlag('f', 1, 'kept', '  ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const ok = build({ existing: { id: 'f', kind: 'flag', status: 'open' } });
    await ok.svc.resolveFlag('f', 1, 'removed');
    expect(ok.saved[0]).toMatchObject({ status: 'removed', resolvedBy: 1 });
  });

  it('correcting a card rewrites its words, keeps the old version and never the quote', async () => {
    const ctx = build({
      existing: {
        id: 'f',
        kind: 'flag',
        status: 'open',
        runId: 'run-1',
        section: 'work_on_this[0]',
      },
    });
    await expect(
      ctx.svc.resolveFlag('f', 1, 'corrected', '', { why: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctx.svc.resolveFlag('f', 1, 'corrected', 'n', { quote: 'z' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await ctx.svc.resolveFlag('f', 1, 'corrected', 'Reworded', {
      why: 'Better why',
    });
    const [, patch] = ctx.runs.update.mock.calls.slice(-1)[0] as any[];
    expect(patch.cards.work_on_this[0]).toMatchObject({
      why: 'Better why',
      quote: 'q3',
    });
    expect(patch.workspace.versions[0].before.work_on_this[0].why).toBe('w');
    expect(ctx.saved.slice(-1)[0]).toMatchObject({ status: 'corrected' });
  });

  it('an escalated flag stays open to resolve, and tells the advisors', async () => {
    const notifier = { escalated: jest.fn() };
    const ctx = build({
      existing: {
        id: 'f',
        kind: 'flag',
        status: 'open',
        scenarioSessionId: 's',
      },
    });
    (ctx.svc as any).notifier = notifier;
    await ctx.svc.escalateFlag('f', 1, 'clinical wording');
    expect(ctx.saved[0]).toMatchObject({ status: 'escalated', urgent: true });
    expect(notifier.escalated).toHaveBeenCalledWith(
      expect.objectContaining({ what: 'flag', note: 'clinical wording' }),
    );
    const again = build({
      existing: { id: 'f', kind: 'flag', status: 'escalated' },
    });
    await again.svc.resolveFlag('f', 137, 'removed');
    expect(again.saved[0]).toMatchObject({ status: 'removed' });
  });

  it('records when the learner first opened the debrief, once (FR-31)', async () => {
    const ctx = build();
    const query = (ctx.svc as any).dataSource.query as jest.Mock;
    const first = await ctx.svc.markOpened('s', 7);
    expect(first.openedAt).toEqual(expect.any(String));
    expect(query.mock.calls.slice(-1)[0][0]).toContain(`'{openedAt}'`);
    const again = build({
      run: { workspace: { openedAt: '2026-11-01T00:00:00Z' } },
    });
    expect(await again.svc.markOpened('s', 7)).toEqual({
      openedAt: '2026-11-01T00:00:00Z',
    });
  });

  it('a person can publish a live draft or send the learner back to today’s debrief', async () => {
    const a = build({ run: { status: 'needs_person' } });
    await a.svc.publishRun('run-1', 1);
    expect(a.runs.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'published' }),
    );
    const b = build({ run: { status: 'needs_person' } });
    await b.svc.fallbackRun('run-1', 1, 'too many cues');
    expect(b.runs.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'skipped',
        skipReason: 'reviewer_fallback',
      }),
    );
    await expect(
      build({ run: { mode: 'shadow' } }).svc.publishRun('run-1', 1),
    ).rejects.toThrow('Live run not found');
  });

  describe('supervisorView (FR-26)', () => {
    const viewer = (tenantId: string | null, platformAdmin = false) => ({
      tenantId,
      platformAdmin,
    });
    const setup = (sessionTenant: string) => {
      const ctx = build();
      const query = (ctx.svc as any).dataSource.query as jest.Mock;
      query.mockImplementation(async (sql: string) =>
        sql.includes('FROM scenario_sessions')
          ? [{ tenant_id: sessionTenant, counselor_id: 7 }]
          : [
              {
                senderId: 7,
                content: 'why that point?',
                createdAt: new Date('2026-11-02T10:00:00Z'),
              },
              {
                senderId: -1,
                content: 'Because…',
                createdAt: new Date('2026-11-02T10:00:05Z'),
              },
            ],
      );
      const fb = (ctx.svc as any).feedback;
      fb.find.mockResolvedValue([
        {
          userId: 7,
          kind: 'flag',
          section: 'what_worked[0]',
          reason: 'didnt_say',
          note: 'n',
          status: 'open',
          resolutionNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          userId: 7,
          kind: 'flag',
          section: 'opening',
          reason: 'something_else',
          status: 'withdrawn',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          userId: 7,
          kind: 'helpful',
          helpful: true,
          status: 'open',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      return ctx;
    };

    it('shows an admin of the same organisation the debrief, flags, helpful and thread, read-only', async () => {
      const view = await setup('t').svc.supervisorView('s1', viewer('t'));
      expect(view.readOnly).toBe(true);
      expect(view.state).toBe('ready');
      expect(view.flags).toEqual([
        expect.objectContaining({
          section: 'what_worked[0]',
          reason: 'didnt_say',
        }),
      ]);
      expect(view.helpful).toBe(true);
      expect(view.thread?.map((m) => m.role)).toEqual(['learner', 'ally']);
    });

    it('refuses an admin of another organisation, but not a platform admin', async () => {
      await expect(
        setup('other').svc.supervisorView('s1', viewer('t')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const view = await setup('other').svc.supervisorView(
        's1',
        viewer('ally', true),
      );
      expect(view.state).toBe('ready');
    });
  });
});

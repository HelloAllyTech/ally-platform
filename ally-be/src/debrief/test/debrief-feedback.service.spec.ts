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
});

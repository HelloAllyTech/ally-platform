import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DebriefLearnerCommentsService } from '../service/debrief-learner-comments.service';
import { DebriefLearnerFeaturesService } from '../service/debrief-learner-features.service';
import { DebriefReviewService } from '../service/debrief-review.service';
import { toGatewayComments } from '../util/debrief-review.util';

const CARDS = {
  opening: 'You asked about her week and let her answer.',
  what_worked: [
    {
      lead: 'Asking directly about loneliness',
      quote: 'Are you feeling lonely these days?',
      body: 'You named it plainly instead of moving on. That gave her room.',
    },
  ],
  work_on_this: [],
};
const RUN = { id: 'run-1', tenantId: 't1', cards: CARDS };

function build(opts: { enabled?: boolean } = {}) {
  const saved: any[] = [];
  const comments: any = {
    create: jest.fn((x) => x),
    save: jest.fn(async (rows) => {
      saved.push(...rows);
      return rows;
    }),
  };
  const feedback: any = { ownLiveRun: jest.fn(async () => RUN) };
  const features: any = {
    isEnabled: jest.fn(async () => opts.enabled ?? true),
  };
  return {
    svc: new DebriefLearnerCommentsService(comments, feedback, features),
    saved,
    feedback,
    features,
  };
}

const WORDS = 'named it plainly instead of moving on';
const start = CARDS.what_worked[0].body.indexOf(WORDS);
const item = (over: Record<string, unknown> = {}) => ({
  section: 'what_worked[0].body',
  spanStart: start,
  spanEnd: start + WORDS.length,
  quotedText: WORDS,
  body: 'This is exactly what I wanted to hear.',
  ...over,
});

describe('a learner comments on selected words in their own debrief', () => {
  it('saves each comment as a learner comment on the card, with the exact words', async () => {
    const { svc, saved } = build();
    const out = await svc.add('s1', 7, { items: [item()] });
    expect(out).toEqual({ saved: 1 });
    expect(saved[0]).toMatchObject({
      runId: 'run-1',
      tenantId: 't1',
      reviewerId: 7,
      anchorKind: 'card',
      section: 'what_worked[0].body',
      quotedText: WORDS,
      source: 'learner',
      status: 'open',
      tag: null,
      parentId: null,
    });
  });

  it('saves an overall comment as a comment on the debrief as a whole, with the others', async () => {
    const { svc, saved } = build();
    const out = await svc.add('s1', 7, {
      overall: 'Helpful, thank you.',
      items: [item()],
    });
    expect(out.saved).toBe(2);
    expect(saved[1]).toMatchObject({
      anchorKind: 'debrief',
      section: null,
      quotedText: null,
      body: 'Helpful, thank you.',
      source: 'learner',
    });
  });

  it('refuses a person who does not have the feature, before touching the debrief', async () => {
    const { svc, feedback } = build({ enabled: false });
    await expect(svc.add('s1', 7, { items: [item()] })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(feedback.ownLiveRun).not.toHaveBeenCalled();
  });

  it('refuses words that are not in the card, an empty comment, and nothing at all', async () => {
    const { svc, saved } = build();
    await expect(
      svc.add('s1', 7, { items: [item({ quotedText: 'something else' })] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.add('s1', 7, { items: [item({ body: '   ' })] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.add('s1', 7, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      svc.add('s1', 7, { items: [item({ section: 'transcript[0]' })] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(saved).toHaveLength(0);
  });

  it('saves nothing when one of several comments is bad', async () => {
    const { svc, saved } = build();
    await expect(
      svc.add('s1', 7, { items: [item(), item({ quotedText: 'nope' })] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(saved).toHaveLength(0);
  });

  it('refuses more than ten at once', async () => {
    const { svc } = build();
    await expect(
      svc.add('s1', 7, { items: Array.from({ length: 11 }, () => item()) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('what the PM agent reads', () => {
  it('marks a learner comment as one, with its words and card, and no name', () => {
    const row = {
      id: 'c1',
      runId: 'run-1',
      parentId: null,
      anchorKind: 'card',
      turnIndex: null,
      section: 'what_worked[0].body',
      spanStart: 3,
      spanEnd: 20,
      quotedText: WORDS,
      body: 'Helpful.',
      tag: null,
      status: 'open',
      ideaId: null,
      repeatOfId: null,
      source: 'learner',
      createdAt: new Date('2026-11-19T00:00:00Z'),
    };
    const [out] = toGatewayComments([row as any], []);
    expect(out.source).toBe('learner');
    expect(out.quoted_text).toBe(WORDS);
    expect(out.anchor.section).toBe('what_worked[0].body');
    expect(Object.keys(out).join(',')).not.toMatch(/reviewer|user|name|email/i);
    const [expert] = toGatewayComments(
      [{ ...row, source: 'expert' } as any],
      [],
    );
    expect(expert.source).toBe('expert');
    const [old] = toGatewayComments([{ ...row, source: undefined } as any], []);
    expect(old.source).toBe('expert');
  });
});

describe('what the review screens read', () => {
  it('says who wrote a comment: a learner, or an expert (including rows from before the field)', () => {
    const view = (source?: string) =>
      (DebriefReviewService.prototype as any).toView.call(
        {},
        {
          id: 'c1',
          runId: 'r1',
          reviewerId: 7,
          reviewerName: 'T',
          body: 'b',
          status: 'open',
          createdAt: new Date(0),
          updatedAt: new Date(0),
          source,
        },
        1,
      );
    expect(view('learner').source).toBe('learner');
    expect(view('expert').source).toBe('expert');
    expect(view(undefined).source).toBe('expert');
  });
});

describe('who has a learner feature', () => {
  function features(rows: any[][]) {
    const calls: any[][] = [];
    const dataSource: any = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        calls.push([sql, params]);
        return rows.shift() ?? [];
      }),
    };
    const access: any = { delete: jest.fn(async () => undefined) };
    return {
      svc: new DebriefLearnerFeaturesService(access, dataSource),
      calls,
    };
  }

  it('is on for a listed person or for everyone, off otherwise, and off when the read fails', async () => {
    const yes = features([[{ '?column?': 1 }]]);
    expect(await yes.svc.isEnabled('selection_comments' as any, 7)).toBe(true);
    expect(yes.calls[0][0]).toContain('"userId" IS NULL OR "userId" = $2');
    const no = features([[]]);
    expect(await no.svc.isEnabled('selection_comments' as any, 7)).toBe(false);
    const broken = new DebriefLearnerFeaturesService(
      {} as any,
      {
        query: jest.fn(async () => {
          throw new Error('db down');
        }),
      } as any,
    );
    expect(await broken.isEnabled('selection_comments' as any, 7)).toBe(false);
  });

  it('adds a person by email, case-insensitively, and refuses an email with no account', async () => {
    const ok = features([[{ id: 9 }], [], []]);
    await ok.svc.grant('selection_comments' as any, ' Tanuja@Example.com ', 1);
    expect(ok.calls[0][1]).toEqual(['tanuja@example.com']);
    expect(ok.calls[1][0]).toContain('ON CONFLICT DO NOTHING');
    expect(ok.calls[1][1]).toEqual(['selection_comments', 9, 1]);
    const none = features([[]]);
    await expect(
      none.svc.grant('selection_comments' as any, 'nobody@example.com', 1),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      none.svc.grant('selection_comments' as any, '  ', 1),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads the people and whether everyone has it', async () => {
    const { svc } = features([
      [
        { userId: null, name: null, email: null, createdAt: new Date(0) },
        { userId: 9, name: 'T', email: 't@x.com', createdAt: new Date(0) },
      ],
    ]);
    const v = await svc.view('selection_comments' as any);
    expect(v.everyone).toBe(true);
    expect(v.people).toEqual([
      {
        userId: 9,
        name: 'T',
        email: 't@x.com',
        addedAt: '1970-01-01T00:00:00.000Z',
      },
    ]);
  });
});

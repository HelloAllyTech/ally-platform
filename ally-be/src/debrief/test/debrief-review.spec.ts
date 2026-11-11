import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  DebriefFeedbackKind,
  DebriefFeedbackStatus,
} from '../enum/debrief-run.enum';
import {
  DebriefCommentAnchor,
  DebriefCommentStatus,
  DebriefReviewVerdict,
} from '../enum/debrief-review.enum';
import { DebriefReviewService } from '../service/debrief-review.service';
import {
  parseSection,
  sectionFieldText,
  toGatewayComments,
  validateAnchor,
} from '../util/debrief-review.util';

const cards = {
  opening: 'You stayed with the client.',
  important_moment: {
    turn_index: 2,
    quote: 'I cannot sleep',
    handled_well: true,
    lead: 'You noticed the sleep problem.',
    body: 'Naming it helped.',
  },
  what_worked: [
    {
      skill: 'open questions',
      turn_index: 1,
      quote: 'What brings you here?',
      lead: 'Your opening let them lead.',
      body: 'It invited them in.',
    },
  ],
  work_on_this: [],
  reflective_question: 'What would you ask next?',
};

const transcript = [
  { turnIndex: 1, text: 'What brings you here?' },
  { turnIndex: 2, text: 'I cannot sleep before exams.' },
];

describe('expert review anchors', () => {
  it('parses card sections and fields, and refuses anything else', () => {
    expect(parseSection('work_on_this[1].why')).toEqual({
      card: 'work_on_this[1]',
      field: 'why',
    });
    expect(parseSection('opening')).toEqual({ card: 'opening', field: null });
    expect(parseSection('opening.lead')).toBeNull();
    expect(parseSection('what_worked[0].try_saying')).toBeNull();
    expect(parseSection('skill_words')).toBeNull();
    expect(parseSection('important_moment.body')).toEqual({
      card: 'important_moment',
      field: 'body',
    });
  });

  it('reads the text a card anchor indexes into', () => {
    expect(sectionFieldText(cards, 'what_worked[0].lead')).toBe(
      'Your opening let them lead.',
    );
    expect(sectionFieldText(cards, 'opening')).toBe(
      'You stayed with the client.',
    );
    expect(sectionFieldText(cards, 'what_worked[3].lead')).toBeUndefined();
    expect(sectionFieldText(cards, 'practise_next.reason')).toBeUndefined();
  });

  it('takes the quote from the turn itself, and refuses a quote that no longer matches', () => {
    const ok = validateAnchor(
      {
        anchorKind: DebriefCommentAnchor.TRANSCRIPT,
        turnIndex: 2,
        spanStart: 2,
        spanEnd: 14,
      },
      { transcript, cards },
    );
    expect(ok).toEqual({
      anchor: {
        anchorKind: 'transcript',
        turnIndex: 2,
        section: null,
        spanStart: 2,
        spanEnd: 14,
        quotedText: 'cannot sleep',
      },
    });
    const stale = validateAnchor(
      {
        anchorKind: DebriefCommentAnchor.TRANSCRIPT,
        turnIndex: 2,
        spanStart: 2,
        spanEnd: 14,
        quotedText: 'can sleep',
      },
      { transcript, cards },
    );
    expect(stale).toHaveProperty('problem');
  });

  it('refuses a turn or card that is not there, and a span past the line', () => {
    expect(
      validateAnchor(
        { anchorKind: DebriefCommentAnchor.TRANSCRIPT, turnIndex: 9 },
        { transcript, cards },
      ),
    ).toHaveProperty('problem');
    expect(
      validateAnchor(
        {
          anchorKind: DebriefCommentAnchor.CARD,
          section: 'work_on_this[0].why',
        },
        { transcript, cards },
      ),
    ).toHaveProperty('problem');
    expect(
      validateAnchor(
        {
          anchorKind: DebriefCommentAnchor.CARD,
          section: 'opening',
          spanStart: 0,
          spanEnd: 999,
        },
        { transcript, cards },
      ),
    ).toHaveProperty('problem');
  });

  it('lets a whole card be commented on without a span, and refuses a span over a whole card object', () => {
    expect(
      validateAnchor(
        { anchorKind: DebriefCommentAnchor.CARD, section: 'what_worked[0]' },
        { transcript, cards },
      ),
    ).toHaveProperty('anchor.section', 'what_worked[0]');
    expect(
      validateAnchor(
        {
          anchorKind: DebriefCommentAnchor.CARD,
          section: 'what_worked[0]',
          spanStart: 0,
          spanEnd: 3,
        },
        { transcript, cards },
      ),
    ).toHaveProperty('problem');
  });

  it('a general comment carries no anchor at all', () => {
    expect(
      validateAnchor(
        {
          anchorKind: DebriefCommentAnchor.DEBRIEF,
          turnIndex: 2,
          spanStart: 0,
          spanEnd: 3,
        },
        { transcript, cards },
      ),
    ).toEqual({
      anchor: {
        anchorKind: 'debrief',
        turnIndex: null,
        section: null,
        spanStart: null,
        spanEnd: null,
        quotedText: null,
      },
    });
  });
});

describe('comments for the PM agent', () => {
  it('threads replies under their comment, with the idea status and no reviewer identity', () => {
    const out = toGatewayComments(
      [
        {
          id: 'c1',
          runId: 'r1',
          parentId: null,
          anchorKind: 'transcript',
          turnIndex: 2,
          section: null,
          spanStart: 2,
          spanEnd: 14,
          quotedText: 'cannot sleep',
          body: 'Missed the sleep cue',
          tag: 'missed_moment',
          status: 'open',
          ideaId: 'i1',
          ideaStatus: 'proposed',
          repeatOfId: null,
          createdAt: '2026-11-10T10:00:00Z',
          recipeKey: 'standard',
          language: 'en',
        },
      ],
      [
        {
          id: 'c3',
          parentId: 'c1',
          body: 'Agree',
          tag: null,
          createdAt: '2026-11-10T12:00:00Z',
        } as any,
        {
          id: 'c2',
          parentId: 'c1',
          body: 'Second look',
          tag: null,
          createdAt: '2026-11-10T11:00:00Z',
        } as any,
      ],
    );
    expect(out).toEqual([
      {
        id: 'c1',
        run_id: 'r1',
        session_type: 'standard',
        language: 'en',
        anchor: {
          kind: 'transcript',
          turn_index: 2,
          section: null,
          span_start: 2,
          span_end: 14,
        },
        quoted_text: 'cannot sleep',
        body: 'Missed the sleep cue',
        tag: 'missed_moment',
        status: 'open',
        idea: { id: 'i1', status: 'proposed' },
        repeat_of_id: null,
        created_at: '2026-11-10T10:00:00.000Z',
        replies: [
          {
            id: 'c2',
            body: 'Second look',
            tag: null,
            created_at: '2026-11-10T11:00:00.000Z',
          },
          {
            id: 'c3',
            body: 'Agree',
            tag: null,
            created_at: '2026-11-10T12:00:00.000Z',
          },
        ],
      },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/reviewer/i);
  });
});

function buildService(
  opts: { mine?: Record<string, unknown> | null; counselorId?: number } = {},
) {
  const run = {
    id: 'run-1',
    scenarioSessionId: 's1',
    tenantId: 't1',
    mode: 'live',
    status: 'published',
    language: 'en',
    recipeKey: 'standard',
    cards,
    hasRiskCue: true,
    learnerDistress: false,
    releaseVersion: 3,
    evaluatorOverall: '8.50',
    evaluatorHardFails: [],
    createdAt: new Date('2026-11-10T09:00:00Z'),
    workspace: {
      safety: {
        risk_cues: [
          {
            turn_index: 2,
            quote: 'cannot sleep',
            category: 'sleep',
            learner_response: 'explored',
          },
        ],
      },
      judge: {
        overall: 6.5,
        hardFails: [{ code: 'missed_risk_cue', evidence: 'x' }],
        dimensions: [],
      },
    },
  };
  let mine = opts.mine ?? null;
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM scenario_sessions')) {
        return [{ counselor_id: opts.counselorId ?? 99 }];
      }
      if (sql.includes('INSERT INTO debrief_reviews')) {
        mine = {
          verdict: DebriefReviewVerdict.NEEDS_WORK,
          hardFails: ['missed_risk_cue'],
          updatedAt: new Date(),
          reviewerId: 7,
        };
        return [];
      }
      return [];
    }),
  };
  const runs = { findOne: jest.fn(async () => run) };
  const reviews = {
    findOne: jest.fn(async () => mine),
    find: jest.fn(async () =>
      [mine, { reviewerId: 8, verdict: 'good', hardFails: [] }].filter(Boolean),
    ),
  };
  const comments = {};
  const feedback = {
    find: jest.fn(async () => [
      {
        id: 'f1',
        kind: DebriefFeedbackKind.FLAG,
        section: 'what_worked[0]',
        reason: 'didnt_say',
        note: 'I never said that',
        status: DebriefFeedbackStatus.KEPT,
        resolutionNote: 'You did, at turn 1',
        createdAt: new Date(),
      },
    ]),
  };
  const context = {
    transcript: jest.fn(async () => [
      { turn_index: 1, role: 'counselor', text: 'Call me on 98765 43210' },
      { turn_index: 2, role: 'client', text: 'I cannot sleep before exams.' },
    ]),
  };
  const service = new DebriefReviewService(
    dataSource as any,
    runs as any,
    reviews as any,
    comments as any,
    feedback as any,
    context as any,
  );
  return { service, dataSource };
}

describe('DebriefReviewService', () => {
  it('keeps the judge, the Evaluator and other verdicts hidden until the reviewer gives theirs', async () => {
    const { service } = buildService();
    const view = await service.detail('run-1', 7);
    expect(view.judge).toBeNull();
    expect(view.evaluator).toBeNull();
    expect(view.otherReviews).toEqual({ count: 1, verdicts: null });
    expect(view.myReview).toBeNull();
    // The transcript is numbered, redacted, and marks the risk cue.
    expect(view.transcript[0]).toMatchObject({
      speaker: 'learner',
      text: 'Call me on [number]',
    });
    expect(view.transcript[1].riskCue).toEqual({
      category: 'sleep',
      learnerResponse: 'explored',
    });
    expect(view.corrections).toEqual([
      {
        section: 'what_worked[0]',
        outcome: 'kept',
        note: 'You did, at turn 1',
      },
    ]);
  });

  it('reveals the judge once a verdict is given', async () => {
    const { service } = buildService();
    const view = await service.setVerdict('run-1', 7, {
      verdict: DebriefReviewVerdict.NEEDS_WORK,
      hardFails: ['missed_risk_cue'],
    });
    expect(view.judge).toEqual({
      overall: 6.5,
      hardFails: ['missed_risk_cue'],
    });
    expect(view.evaluator).toEqual({ overall: 8.5, hardFails: [] });
    expect(view.otherReviews.verdicts).toEqual([
      { verdict: 'good', hardFails: [] },
    ]);
  });

  it('refuses a Good verdict with a hard fail, and an unknown hard fail', async () => {
    const { service } = buildService();
    await expect(
      service.setVerdict('run-1', 7, {
        verdict: DebriefReviewVerdict.GOOD,
        hardFails: ['missed_risk_cue'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setVerdict('run-1', 7, {
        verdict: DebriefReviewVerdict.NEEDS_WORK,
        hardFails: ['too_long'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never lets someone review a debrief of their own practice', async () => {
    const { service } = buildService({ counselorId: 7 });
    await expect(service.detail('run-1', 7)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses an empty comment before touching the database', async () => {
    const { service } = buildService();
    await expect(
      service.addComment('run-1', 7, {
        anchorKind: DebriefCommentAnchor.DEBRIEF,
        body: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads comments for the PM agent with the filters it asked for', async () => {
    const { service, dataSource } = buildService();
    await service.commentsForAgent({
      since: '2026-11-01T00:00:00Z',
      status: DebriefCommentStatus.OPEN,
      limit: 500,
    });
    const calls = dataSource.query.mock.calls;
    const [sql, params] = calls[calls.length - 1] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain('c."parentId" IS NULL');
    expect(sql).not.toMatch(/cards|workspace|transcript/);
    expect(params).toEqual([new Date('2026-11-01T00:00:00Z'), 'open', 200]);
    await expect(
      service.commentsForAgent({ since: 'yesterday' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

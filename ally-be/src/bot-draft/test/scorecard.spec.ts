import { NotFoundException } from '@nestjs/common';
import {
  addDays,
  dayOf,
  sumDays,
  weekStart,
  type DayStats,
} from '../checkup/checkup-stats';
import { ScorecardService } from '../scorecard/scorecard.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => null,
    getExecutionId: () => undefined,
  },
}));

const day = (d: string, over: Partial<DayStats> = {}): DayStats => ({
  day: d,
  conversations: 0,
  answers: 0,
  answeredWithSource: 0,
  declined: 0,
  wrongDeclineSuspected: 0,
  handedOver: 0,
  crisis: 0,
  thumbsUp: 0,
  thumbsDown: 0,
  replyMsP50: null,
  replyMsP90: null,
  ...over,
});

describe('live numbers (checkup-stats)', () => {
  it('uses India days and Monday weeks', () => {
    // 20:00 UTC on Sunday 9 Nov is 01:30 on Monday 10 Nov in India.
    expect(dayOf(new Date('2026-11-09T20:00:00Z'))).toBe('2026-11-10');
    expect(weekStart('2026-11-10')).toBe('2026-11-09');
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
    expect(weekStart('2026-11-15')).toBe('2026-11-09');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('sums a week and works out the two rates', () => {
    const week = sumDays([
      day('2026-11-09', {
        conversations: 3,
        answers: 4,
        answeredWithSource: 3,
        thumbsUp: 1,
      }),
      day('2026-11-10', {
        conversations: 2,
        answers: 6,
        answeredWithSource: 5,
        declined: 1,
        thumbsDown: 1,
      }),
    ]);
    expect(week).toMatchObject({
      conversations: 5,
      answers: 10,
      answeredWithSource: 8,
      declined: 1,
      answeredPct: 80,
      thumbsUpPct: 50,
    });
    expect(sumDays([]).answeredPct).toBe(0);
    expect(sumDays([]).thumbsUpPct).toBeNull();
  });
});

function harness() {
  const stored: Record<string, unknown>[] = [];
  const today = {
    chatbot_id: 'bot-1',
    day: '2026-11-12',
    conversations: '4',
    answers: '5',
    answered_with_source: '4',
    declined: '1',
    wrong_decline_suspected: '1',
    handed_over: '0',
    crisis: '0',
    thumbs_up: '2',
    thumbs_down: '1',
    reply_ms_p50: 7000,
    reply_ms_p90: 12000,
  };
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM chatbot_daily_stats')) return stored;
    if (sql.includes('WITH msg AS')) return [today];
    if (
      sql.includes('FROM wa_unanswered_questions q') &&
      sql.includes('LIMIT')
    ) {
      return [
        { id: 'q-1', question: 'Do you take insurance?', at: new Date() },
      ];
    }
    if (sql.includes('FROM wa_unanswered_questions q')) {
      return params[0] === 'q-1'
        ? [{ id: 'q-1', question: 'Do you take insurance?' }]
        : [];
    }
    if (sql.includes('FROM chatbot_message_feedback f')) return [];
    if (sql.includes('JOIN chatbot_messages q ON q.id = a.in_reply_to_id')) {
      return [{ text: 'How much is a session?' }];
    }
    return [];
  });
  const feedbackRows = new Map([
    [
      'f-1',
      { id: 'f-1', chatbotId: 'bot-1', rating: 'down', messageId: 'm-2' },
    ],
  ]);
  const feedback = {
    findOne: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        feedbackRows.get(where.id) ?? null,
    ),
    update: jest.fn(),
  };
  const access = { assert: jest.fn(async () => ({})) };
  const checkup = { latestFor: jest.fn(async () => null) };
  const draftCheckup = { addOwnerAnswer: jest.fn(async () => ({ ok: true })) };
  const service = new ScorecardService(
    { query } as never,
    access as never,
    checkup as never,
    draftCheckup as never,
    feedback as never,
  );
  return { service, query, stored, access, feedback, draftCheckup };
}

describe('ScorecardService', () => {
  // Thursday 12 Nov 2026, 10:00 in India.
  const NOW = new Date('2026-11-12T04:30:00Z');

  it('this week against last, with today worked out live', async () => {
    const h = harness();
    h.stored.push(
      {
        day: '2026-11-03',
        conversations: 7,
        answers: 10,
        answered_with_source: 6,
      },
      {
        day: '2026-11-10',
        conversations: 2,
        answers: 2,
        answered_with_source: 2,
      },
    );
    const view = await h.service.view('bot-1', NOW);
    expect(view.thisWeek).toMatchObject({
      conversations: 6,
      answers: 7,
      answeredWithSource: 6,
      declined: 1,
      wrongDeclineSuspected: 1,
      thumbsUp: 2,
      thumbsDown: 1,
      answeredPct: 86,
    });
    expect(view.lastWeek).toMatchObject({ conversations: 7, answeredPct: 60 });
    expect(view.trend.map((t) => t.day)).toEqual([
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
    expect(view.trend[view.trend.length - 1]).toEqual({
      day: '2026-11-12',
      answeredPct: 80,
    });
    expect(view.trend[0].answeredPct).toBeNull();
    expect(view.unanswered).toHaveLength(1);
    expect(h.access.assert).toHaveBeenCalledWith('bot-1', 'viewer');
  });

  it('works out a past day the job has not stored yet, instead of reading it as zero', async () => {
    const h = harness();
    await h.service.view('bot-1', NOW);
    const live = h.query.mock.calls.filter(([sql]) =>
      String(sql).includes('WITH msg AS'),
    );
    // Nothing stored: the window (from last Monday, 2 Nov) is worked out live, in one query.
    expect(live).toHaveLength(1);
    expect((live[0][1] as unknown[]).slice(1, 3)).toEqual([
      '2026-11-02',
      '2026-11-13',
    ]);
  });

  it('never reads stored rows for today', async () => {
    const h = harness();
    await h.service.view('bot-1', NOW);
    const stored = h.query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM chatbot_daily_stats'),
    )!;
    expect(stored[1]).toContain('2026-11-12');
    expect(String(stored[0])).toContain('day < $4::date');
  });

  it('Answer it: an owner note and a checkup question, and the question is answered', async () => {
    const h = harness();
    await h.service.answerUnanswered(
      'bot-1',
      'q-1',
      'We give a receipt to claim.',
    );
    expect(h.draftCheckup.addOwnerAnswer).toHaveBeenCalledWith(
      'bot-1',
      'Do you take insurance?',
      'We give a receipt to claim.',
      // "Also add to checkup", ticked by default (chunk 20d-2).
      { addToCheckup: true, addedFrom: 'unanswered' },
    );
    const update = h.query.mock.calls.find(([sql]) =>
      String(sql).startsWith('UPDATE wa_unanswered_questions'),
    )!;
    expect(update[1]).toEqual(['q-1', 'answered', 7]);
    expect(h.access.assert).toHaveBeenCalledWith('bot-1', 'editor');
  });

  it('refuses a question from another assistant', async () => {
    const h = harness();
    await expect(
      h.service.answerUnanswered('bot-1', 'q-other', 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.draftCheckup.addOwnerAnswer).not.toHaveBeenCalled();
  });

  it('Correct this answers what they asked, and It was fine closes it', async () => {
    const h = harness();
    await h.service.correctFeedback('bot-1', 'f-1', 'A session is Rs. 2,000.');
    expect(h.draftCheckup.addOwnerAnswer).toHaveBeenCalledWith(
      'bot-1',
      'How much is a session?',
      'A session is Rs. 2,000.',
      { addToCheckup: true, addedFrom: 'thumbs_down' },
    );
    expect(h.feedback.update).toHaveBeenLastCalledWith(
      { id: 'f-1' },
      expect.objectContaining({ status: 'corrected', handledBy: 7 }),
    );
    await h.service.markFine('bot-1', 'f-1');
    expect(h.feedback.update).toHaveBeenLastCalledWith(
      { id: 'f-1' },
      expect.objectContaining({ status: 'fine' }),
    );
  });
});

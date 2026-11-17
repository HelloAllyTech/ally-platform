import {
  readReviewUndo,
  reviewUndoKey,
  scoreLeadCandidates,
  signReviewUndo,
} from '../roadmap-review.util';

describe('suggested lead', () => {
  it('puts free slots first, then past ideas in the same apps', () => {
    const scored = scoreLeadCandidates(
      [
        { userId: 1, leading: 3, ideasByApp: { admin: 9 } },
        { userId: 2, leading: 1, ideasByApp: { admin: 4, be: 2 } },
        { userId: 3, leading: 1, ideasByApp: { mobile: 7 } },
      ],
      3,
      ['admin'],
    );
    expect(scored.map((c) => c.userId)).toEqual([2, 3, 1]);
    expect(scored[0]).toMatchObject({
      freeSlots: 2,
      limit: 3,
      matchingIdeas: 4,
      appsTouched: ['admin'],
    });
    expect(scored[2].freeSlots).toBe(0);
  });

  it('counts every app when the idea touches nothing known yet', () => {
    const [only] = scoreLeadCandidates(
      [{ userId: 5, leading: 0, ideasByApp: { be: 2, admin: 3 } }],
      3,
      [],
    );
    expect(only.matchingIdeas).toBe(5);
    expect(only.appsTouched).toEqual(['admin', 'be']);
  });

  it('breaks ties by fewer ideas led, then id, so it is stable', () => {
    const scored = scoreLeadCandidates(
      [
        { userId: 9, leading: 0, ideasByApp: {} },
        { userId: 4, leading: 0, ideasByApp: {} },
      ],
      2,
      [],
    );
    expect(scored.map((c) => c.userId)).toEqual([4, 9]);
  });
});

describe('review undo token', () => {
  const key = reviewUndoKey('test-secret');
  const payload = {
    v: 1 as const,
    u: 7,
    exp: 2_000,
    items: [
      {
        id: 'a',
        code: 'OPP-0001',
        sessionId: null,
        prev: {
          reviewState: 'pending',
          reviewedBy: null,
          reviewedAt: null,
          declineReason: null,
          leadUserId: null,
        },
        next: { reviewState: 'accepted', leadUserId: null },
      },
    ],
  };

  it('round-trips inside its window', () => {
    const read = readReviewUndo(signReviewUndo(payload, key), key, 1_000);
    expect(read).toEqual({ ok: true, payload });
  });

  it('expires', () => {
    expect(readReviewUndo(signReviewUndo(payload, key), key, 3_000)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses a tampered or foreign token', () => {
    const token = signReviewUndo(payload, key);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, u: 8 })).toString(
      'base64url',
    );
    expect(readReviewUndo(`${forged}.${sig}`, key, 1_000).ok).toBe(false);
    expect(readReviewUndo(token, reviewUndoKey('other'), 1_000)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(readReviewUndo(`${body}`, key, 1_000).ok).toBe(false);
    expect(readReviewUndo('', key, 1_000).ok).toBe(false);
  });
});

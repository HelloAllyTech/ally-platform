import {
  CUSTOMER_THRESHOLDS as T,
  CustomerFacts,
  attentionScore,
  customerReasons,
} from '../customer-health.constants';

const facts = (over: Partial<CustomerFacts> = {}): CustomerFacts => ({
  learners: 40,
  completedTotal: 500,
  completedLast28d: 60,
  completedPrev28d: 60,
  daysSinceLastCompleted: 2,
  neverStartedLearners: 4,
  reviewedLast28d: 40,
  ratingsCount90d: 30,
  ratingsAverage90d: 4.4,
  creditUtilisationPct: 40,
  ...over,
});
const ids = (f: CustomerFacts) => customerReasons(f).map((r) => r.id);

describe('customerReasons', () => {
  it('has nothing to say about an organisation that is doing well', () => {
    expect(customerReasons(facts())).toEqual([]);
  });

  it('says an organisation with learners and no sessions ever has never been active', () => {
    expect(
      ids(
        facts({
          completedTotal: 0,
          daysSinceLastCompleted: null,
          completedLast28d: 0,
          completedPrev28d: 0,
          neverStartedLearners: 40,
        }),
      ),
    ).toEqual(['neverActive']);
  });

  it('says quiet from the threshold, and more seriously when long', () => {
    expect(ids(facts({ daysSinceLastCompleted: T.quietDays - 1 }))).toEqual([]);
    const quiet = customerReasons(
      facts({ daysSinceLastCompleted: T.quietDays }),
    );
    expect(quiet[0]).toMatchObject({
      id: 'quiet',
      severity: 3,
      params: { days: 21 },
    });
    expect(
      customerReasons(facts({ daysSinceLastCompleted: T.longQuietDays }))[0]
        .severity,
    ).toBe(4);
  });

  it('does not add a fall on top of silence', () => {
    expect(
      ids(
        facts({
          daysSinceLastCompleted: 30,
          completedLast28d: 0,
          completedPrev28d: 50,
        }),
      ),
    ).toEqual(['quiet']);
  });

  it('flags a fall only against a period with enough sessions to compare', () => {
    expect(
      ids(facts({ completedPrev28d: 100, completedLast28d: 60 })),
    ).toContain('activityDown');
    expect(
      ids(facts({ completedPrev28d: 100, completedLast28d: 70 })),
    ).not.toContain('activityDown');
    expect(
      ids(facts({ completedPrev28d: 9, completedLast28d: 0 })),
    ).not.toContain('activityDown');
  });

  it('flags learners who never started once they are a large enough share', () => {
    expect(ids(facts({ neverStartedLearners: 16 }))).toContain('neverStarted');
    expect(ids(facts({ neverStartedLearners: 15 }))).not.toContain(
      'neverStarted',
    );
  });

  it('flags reviews backing up, credits near the limit and a low rating', () => {
    expect(ids(facts({ reviewedLast28d: 20 }))).toContain('reviewsBehind');
    expect(ids(facts({ creditUtilisationPct: 91 }))).toContain(
      'creditsNearLimit',
    );
    expect(ids(facts({ creditUtilisationPct: null }))).not.toContain(
      'creditsNearLimit',
    );
    expect(ids(facts({ ratingsAverage90d: 3.2 }))).toContain('lowRating');
    expect(
      ids(facts({ ratingsAverage90d: 3.2, ratingsCount90d: 9 })),
    ).not.toContain('lowRating');
  });

  it('congratulates a clear rise, as good news and not a worry', () => {
    const rise = customerReasons(
      facts({ completedPrev28d: 40, completedLast28d: 60 }),
    );
    expect(rise).toEqual([
      expect.objectContaining({
        id: 'activityUp',
        polarity: 'celebrate',
        severity: 0,
      }),
    ]);
    expect(attentionScore(rise)).toBe(0);
  });

  it('draws no rate for an organisation under the learner floor, but still notices silence', () => {
    const small = facts({
      learners: T.minLearnersForRates - 1,
      neverStartedLearners: 3,
      reviewedLast28d: 0,
      ratingsAverage90d: 1.5,
      completedPrev28d: 100,
      completedLast28d: 10,
      daysSinceLastCompleted: 40,
    });
    expect(ids(small)).toEqual(['quiet']);
  });

  it('orders reasons by how serious they are, and adds up the worries', () => {
    const reasons = customerReasons(
      facts({
        daysSinceLastCompleted: 70,
        creditUtilisationPct: 95,
        reviewedLast28d: 10,
      }),
    );
    expect(reasons.map((r) => r.id)).toEqual([
      'quiet',
      'creditsNearLimit',
      'reviewsBehind',
    ]);
    expect(attentionScore(reasons)).toBe(4 + 2 + 1);
  });
});

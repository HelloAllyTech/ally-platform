import { BuilderNotificationKind } from 'src/builder/enum/builder.enum';
import {
  PlanNotificationKind,
  RoadmapNotificationKind as K,
  RoadmapWatchLevel as W,
} from '../../enum/product-planning.enum';
import {
  effectiveWatchLevel,
  kindForBuilderNotification,
  kindForPlanNotification,
  RecipientFacts,
  recipientsFor,
  roadmapGroupKey,
} from '../roadmap-recipients.util';

// One person in each column of the §4.8 table.
const AUTHOR = 1;
const LEAD = 2;
const OWNER = 3;
const VOTER = 4;
const WATCH_ALL = 5;
const WATCH_MILESTONES = 6;
const STRANGER = 7;

const facts = (over: Partial<RecipientFacts> = {}): RecipientFacts => ({
  authorUserId: AUTHOR,
  leadUserId: LEAD,
  ownerIds: [OWNER],
  voterIds: [VOTER],
  watches: [
    { userId: WATCH_ALL, level: W.ALL },
    { userId: WATCH_MILESTONES, level: W.MILESTONES },
  ],
  ...over,
});

describe('recipientsFor (§4.8)', () => {
  it.each([
    [K.SUBMITTED, [OWNER]],
    [K.ACCEPTED, [AUTHOR, LEAD, VOTER, WATCH_ALL, WATCH_MILESTONES]],
    [K.DECLINED, [AUTHOR, LEAD, VOTER, WATCH_ALL, WATCH_MILESTONES]],
    [K.LEAD_ASSIGNED, [AUTHOR, LEAD, VOTER, WATCH_ALL, WATCH_MILESTONES]],
    [K.ASSIGNED_TO_YOU, [LEAD, OWNER]],
    [K.HANDED_BACK, [LEAD, OWNER]],
    [K.AGENT_QUESTION, [AUTHOR, LEAD, WATCH_ALL]],
    [K.ANSWERS_CONFLICT, [LEAD]],
    [K.DECISION_NEEDED, [LEAD]],
    [K.SHIPPED, [AUTHOR, LEAD, VOTER, WATCH_ALL, WATCH_MILESTONES]],
    [K.OUTCOME_REVIEWED, [AUTHOR, LEAD, VOTER, WATCH_ALL, WATCH_MILESTONES]],
    [K.RELEASE_HELD, [LEAD, OWNER]],
    [K.RELEASE_FAILED, [LEAD, OWNER]],
    [K.BREAKER_OPEN, [LEAD, OWNER]],
    [K.BUDGET, [LEAD, OWNER]],
    [K.MENTION, []],
    [K.ACTIVITY, []],
    [K.PLAN_READY, [AUTHOR, LEAD, VOTER, WATCH_ALL, WATCH_MILESTONES]],
    [K.PLAN_CLOSED, [AUTHOR, LEAD, VOTER, WATCH_ALL, WATCH_MILESTONES]],
    [K.COMMENT, [AUTHOR, LEAD, WATCH_ALL]],
    [K.QUESTION_ANSWERED, [LEAD]],
  ])('%s goes to %j', (kind, expected) => {
    expect(recipientsFor(kind, facts())).toEqual(expected);
  });

  describe('the planner (idea-to-plan audit rec 8)', () => {
    const PLANNER = 8;
    it("gets the lead's column and default watch while nobody leads the idea", () => {
      const f = facts({ leadUserId: null, plannerUserId: PLANNER });
      expect(recipientsFor(K.AGENT_QUESTION, f)).toContain(PLANNER);
      expect(recipientsFor(K.QUESTION_ANSWERED, f)).toEqual([PLANNER]);
      expect(recipientsFor(K.COMMENT, f)).toContain(PLANNER);
      expect(effectiveWatchLevel(PLANNER, f)).toBe(W.ALL);
    });
    it('steps aside once a builder leads it', () => {
      const f = facts({ plannerUserId: PLANNER });
      expect(recipientsFor(K.QUESTION_ANSWERED, f)).toEqual([LEAD]);
      expect(effectiveWatchLevel(PLANNER, f)).toBe(W.NONE);
    });
    it('is never told about their own action', () => {
      const f = facts({
        leadUserId: null,
        plannerUserId: PLANNER,
        actorUserId: PLANNER,
      });
      expect(recipientsFor(K.PLAN_CLOSED, f)).not.toContain(PLANNER);
    });
  });

  it('a comment respects watch levels: Milestones and None hear nothing', () => {
    const f = facts({ watches: [{ userId: AUTHOR, level: W.NONE }] });
    const out = recipientsFor(K.COMMENT, f);
    expect(out).not.toContain(AUTHOR);
    expect(out).not.toContain(VOTER);
    expect(out).not.toContain(WATCH_MILESTONES);
  });

  it('covers every kind', () => {
    for (const kind of Object.values(K)) {
      expect(() => recipientsFor(kind, facts())).not.toThrow();
    }
  });

  it('includes the lead on milestone events through their default All watch', () => {
    // The table's Lead column is empty for Accepted; the lead still hears
    // because leads start on All.
    expect(recipientsFor(K.ACCEPTED, facts())).toContain(LEAD);
    expect(
      recipientsFor(
        K.ACCEPTED,
        facts({ watches: [{ userId: LEAD, level: W.NONE }] }),
      ),
    ).not.toContain(LEAD);
  });

  it('asks the author to settle conflicting answers only before a lead exists', () => {
    expect(
      recipientsFor(K.ANSWERS_CONFLICT, facts({ leadUserId: null })),
    ).toEqual([AUTHOR]);
  });

  it('lets a watch of None silence a voter but never a role column', () => {
    const muted = facts({
      watches: [
        { userId: VOTER, level: W.NONE },
        { userId: AUTHOR, level: W.NONE },
      ],
    });
    expect(recipientsFor(K.SHIPPED, muted)).not.toContain(VOTER);
    // The author column applies to Shipped whatever their watch says.
    expect(recipientsFor(K.SHIPPED, muted)).toContain(AUTHOR);
  });

  it('gives Milestones watchers milestones but not questions', () => {
    expect(recipientsFor(K.SHIPPED, facts())).toContain(WATCH_MILESTONES);
    expect(recipientsFor(K.AGENT_QUESTION, facts())).not.toContain(
      WATCH_MILESTONES,
    );
    expect(recipientsFor(K.AGENT_QUESTION, facts())).not.toContain(VOTER);
  });

  it('upgrades a voter who chose All to questions too', () => {
    expect(
      recipientsFor(
        K.AGENT_QUESTION,
        facts({ watches: [{ userId: VOTER, level: W.ALL }] }),
      ),
    ).toContain(VOTER);
  });

  it('always keeps the people the writer names (dual-write, @mentions)', () => {
    expect(
      recipientsFor(K.ACTIVITY, facts({ directRecipientIds: [STRANGER] })),
    ).toEqual([STRANGER]);
    expect(
      recipientsFor(
        K.MENTION,
        facts({ directRecipientIds: [VOTER, STRANGER] }),
      ),
    ).toEqual([VOTER, STRANGER]);
  });

  it('never tells the actor about their own action', () => {
    expect(
      recipientsFor(K.ACCEPTED, facts({ actorUserId: AUTHOR })),
    ).not.toContain(AUTHOR);
  });

  it('copes with an idea that has no lead, no voters and no Owners', () => {
    expect(
      recipientsFor(
        K.RELEASE_FAILED,
        facts({ leadUserId: null, ownerIds: [] }),
      ),
    ).toEqual([]);
  });

  it('dedupes someone in several columns', () => {
    expect(
      recipientsFor(
        K.SHIPPED,
        facts({ authorUserId: LEAD, voterIds: [LEAD], watches: [] }),
      ),
    ).toEqual([LEAD]);
  });
});

describe('effectiveWatchLevel', () => {
  it('reads a row first, then the relationship default', () => {
    const f = facts();
    expect(effectiveWatchLevel(WATCH_MILESTONES, f)).toBe(W.MILESTONES);
    expect(effectiveWatchLevel(AUTHOR, f)).toBe(W.ALL);
    expect(effectiveWatchLevel(LEAD, f)).toBe(W.ALL);
    expect(effectiveWatchLevel(VOTER, f)).toBe(W.MILESTONES);
    expect(effectiveWatchLevel(STRANGER, f)).toBe(W.NONE);
  });
});

describe('roadmapGroupKey', () => {
  it('collapses one idea and kind inside ten minutes, and splits across the window', () => {
    const at = (iso: string) => new Date(iso);
    const key = (iso: string) =>
      roadmapGroupKey(K.AGENT_QUESTION, { itemId: 'i1' }, at(iso));
    expect(key('2026-11-17T10:01:00Z')).toBe(key('2026-11-17T10:09:59Z'));
    expect(key('2026-11-17T10:09:59Z')).not.toBe(key('2026-11-17T10:10:00Z'));
    expect(
      roadmapGroupKey(K.SHIPPED, { itemId: 'i1' }, at('2026-11-17T10:01:00Z')),
    ).not.toBe(key('2026-11-17T10:01:00Z'));
    expect(
      roadmapGroupKey(
        K.BUDGET,
        { sessionId: 's1' },
        at('2026-11-17T10:01:00Z'),
      ),
    ).toMatch(/^session:s1:budget:/);
  });
});

describe('mapping the old writers', () => {
  it('maps Builder kinds', () => {
    expect(
      kindForBuilderNotification(BuilderNotificationKind.QUESTION_PENDING),
    ).toBe(K.AGENT_QUESTION);
    expect(
      kindForBuilderNotification(BuilderNotificationKind.PR_READY_TO_MERGE),
    ).toBe(K.DECISION_NEEDED);
    expect(
      kindForBuilderNotification(BuilderNotificationKind.BUDGET_REACHED),
    ).toBe(K.BUDGET);
    expect(
      kindForBuilderNotification(BuilderNotificationKind.RELEASE_FAILED),
    ).toBe(K.RELEASE_FAILED);
    expect(
      kindForBuilderNotification(BuilderNotificationKind.RELEASE_SKIPPED),
    ).toBe(K.RELEASE_HELD);
    expect(
      kindForBuilderNotification(BuilderNotificationKind.BUILD_COMPLETED),
    ).toBe(K.ACTIVITY);
    for (const kind of Object.values(BuilderNotificationKind)) {
      expect(Object.values(K)).toContain(kindForBuilderNotification(kind));
    }
  });

  it('maps plan kinds', () => {
    expect(kindForPlanNotification(PlanNotificationKind.TAKEN_ON)).toBe(
      K.LEAD_ASSIGNED,
    );
    expect(kindForPlanNotification(PlanNotificationKind.AUTO_RELEASED)).toBe(
      K.HANDED_BACK,
    );
    expect(kindForPlanNotification(PlanNotificationKind.LAUNCHED)).toBe(
      K.SHIPPED,
    );
    expect(kindForPlanNotification(PlanNotificationKind.OUTCOME)).toBe(
      K.OUTCOME_REVIEWED,
    );
    expect(kindForPlanNotification(PlanNotificationKind.CEILING_WARNING)).toBe(
      K.BUDGET,
    );
    expect(kindForPlanNotification(PlanNotificationKind.NUDGE)).toBe(
      K.ACTIVITY,
    );
    for (const kind of Object.values(PlanNotificationKind)) {
      expect(Object.values(K)).toContain(kindForPlanNotification(kind));
    }
  });
});

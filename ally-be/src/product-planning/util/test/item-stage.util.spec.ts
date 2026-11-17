import {
  deriveItemStage,
  ItemStageFacts,
  ITEM_TRACKER,
  PlanStageFacts,
} from '../plan-stage.util';

const plan = (over: Partial<PlanStageFacts> = {}) => ({
  private: false,
  closed: false,
  leadUserId: null,
  prdReady: false,
  designApproved: false,
  buildStarted: false,
  shipped: false,
  launched: false,
  reviewsDue: 0,
  reviewsDone: 0,
  ...over,
});

const opp = (
  over: Partial<NonNullable<ItemStageFacts['opportunity']>> = {},
): NonNullable<ItemStageFacts['opportunity']> => ({
  stage: 'new',
  reviewState: 'accepted',
  reviewedBy: 1,
  reviewedAt: '2026-11-03T00:00:00.000Z',
  filedAt: '2026-11-01T00:00:00.000Z',
  votes: 6,
  releasedAt: null,
  ...over,
});

const derive = (facts: Partial<ItemStageFacts>) =>
  deriveItemStage({ opportunity: opp(), plan: null, ...facts });

describe('deriveItemStage', () => {
  it('names the five tracker steps in order', () => {
    expect(ITEM_TRACKER).toEqual([
      'submitted',
      'accepted',
      'planning',
      'building',
      'shipped',
    ]);
  });

  describe('Draft', () => {
    it('is a draft while there is no opportunity row, with its checks', () => {
      expect(
        deriveItemStage({
          opportunity: null,
          plan: { ...plan({ private: true }), checksMet: 3, checksTotal: 5 },
        }),
      ).toEqual({
        shownStage: 'draft',
        statusParts: { stage: 'draft', checksMet: 3, checksTotal: 5 },
      });
    });

    it('reads no checks as 0 of 0 rather than inventing progress', () => {
      expect(
        deriveItemStage({ opportunity: null, plan: null }).statusParts,
      ).toEqual({ stage: 'draft', checksMet: 0, checksTotal: 0 });
    });
  });

  describe('Submitted', () => {
    it('waits for review with its filing date and votes', () => {
      expect(derive({ opportunity: opp({ reviewState: 'pending' }) })).toEqual({
        shownStage: 'submitted',
        statusParts: {
          stage: 'submitted',
          since: '2026-11-01T00:00:00.000Z',
          votes: 6,
        },
      });
    });

    it('stays submitted even if a lead was somehow set before review', () => {
      expect(
        derive({
          opportunity: opp({ reviewState: 'pending' }),
          plan: plan({ leadUserId: 9 }),
        }).shownStage,
      ).toBe('submitted');
    });
  });

  describe('Declined', () => {
    it('wins over everything, and carries who and when but never the reason', () => {
      const result = derive({
        opportunity: opp({
          reviewState: 'declined',
          reviewedBy: 2,
          reviewedAt: '2026-11-05T00:00:00.000Z',
          stage: 'released',
        }),
        plan: plan({ leadUserId: 4, buildStarted: true, closed: true }),
      });
      expect(result).toEqual({
        shownStage: 'declined',
        statusParts: {
          stage: 'declined',
          byUserId: 2,
          at: '2026-11-05T00:00:00.000Z',
        },
      });
      expect(JSON.stringify(result)).not.toMatch(/reason/i);
    });
  });

  describe('Accepted', () => {
    it('needs a lead when nobody leads it', () => {
      expect(derive({ plan: plan() })).toEqual({
        shownStage: 'accepted',
        statusParts: {
          stage: 'accepted',
          leadUserId: null,
          needsLead: true,
          votes: 6,
        },
      });
    });

    it('names the lead while planning has not started', () => {
      expect(
        derive({ plan: { ...plan({ leadUserId: 7 }), planningStarted: false } })
          .statusParts,
      ).toEqual({
        stage: 'accepted',
        leadUserId: 7,
        needsLead: false,
        votes: 6,
      });
    });

    it('reads a never-reviewed row (reviewState null) as accepted', () => {
      expect(
        derive({ opportunity: opp({ reviewState: null }) }).shownStage,
      ).toBe('accepted');
    });
  });

  describe('Planning', () => {
    it('is on the PRD once a lead holds it (rev 5.2 meaning by default)', () => {
      expect(
        derive({
          plan: plan({ leadUserId: 7 }),
          planning: {
            prdPercent: 70,
            openQuestions: 2,
            designAwaitingApproval: false,
          },
        }),
      ).toEqual({
        shownStage: 'planning',
        statusParts: {
          stage: 'planning',
          step: 'prd',
          leadUserId: 7,
          prdPercent: 70,
          openQuestions: 2,
          designAwaitingApproval: false,
        },
      });
    });

    it('moves to design, then ready', () => {
      expect(
        derive({
          plan: {
            ...plan({ leadUserId: 7, prdReady: true }),
            planningStarted: true,
          },
          planning: {
            prdPercent: 100,
            openQuestions: 0,
            designAwaitingApproval: true,
          },
        }).statusParts,
      ).toMatchObject({ step: 'design', designAwaitingApproval: true });
      expect(
        derive({
          plan: plan({ leadUserId: 7, prdReady: true, designApproved: true }),
        }).statusParts,
      ).toMatchObject({ stage: 'planning', step: 'ready' });
    });

    it('defaults unknown planning detail to nothing known', () => {
      expect(derive({ plan: plan({ leadUserId: 7 }) }).statusParts).toEqual({
        stage: 'planning',
        step: 'prd',
        leadUserId: 7,
        prdPercent: null,
        openQuestions: 0,
        designAwaitingApproval: false,
      });
    });
  });

  describe('Building', () => {
    it('builds here once a run exists', () => {
      expect(
        derive({
          plan: plan({
            leadUserId: 7,
            designApproved: true,
            buildStarted: true,
          }),
          build: {
            externalBuild: null,
            repos: ['ally-be', 'ally-web'],
            openPrs: [{ number: 412, ci: 'passing' }],
            mergedPrs: 0,
            releasing: false,
            heldReason: null,
          },
        }),
      ).toEqual({
        shownStage: 'building',
        statusParts: {
          stage: 'building',
          where: 'here',
          leadUserId: 7,
          externalBuild: null,
          repos: ['ally-be', 'ally-web'],
          openPrs: [{ number: 412, ci: 'passing' }],
          mergedPrs: 0,
          waitingForPr: false,
          releasing: false,
          heldReason: null,
        },
      });
    });

    it('is building in Claude Code once the brief is sent, waiting for a PR', () => {
      const parts = derive({
        plan: plan({ leadUserId: 7, designApproved: true }),
        build: {
          externalBuild: { byUserId: 7, at: '2026-11-10T00:00:00.000Z' },
          repos: [],
          openPrs: [],
          mergedPrs: 0,
          releasing: false,
          heldReason: null,
        },
      }).statusParts;
      expect(parts).toMatchObject({
        stage: 'building',
        where: 'claude_code',
        waitingForPr: true,
      });
    });

    it('stops waiting once a PR carrying the code appears', () => {
      expect(
        derive({
          plan: plan({ leadUserId: 7, designApproved: true }),
          build: {
            externalBuild: { byUserId: 7, at: '2026-11-10T00:00:00.000Z' },
            repos: ['ally-be'],
            openPrs: [{ number: 9, ci: 'pending' }],
            mergedPrs: 0,
            releasing: false,
            heldReason: null,
          },
        }).statusParts,
      ).toMatchObject({ where: 'claude_code', waitingForPr: false });
    });

    it('shows merged-and-releasing and a held release', () => {
      expect(
        derive({
          plan: plan({ leadUserId: 7, buildStarted: true }),
          build: {
            externalBuild: null,
            repos: ['ally-be'],
            openPrs: [],
            mergedPrs: 1,
            releasing: true,
            heldReason: 'migration',
          },
        }).statusParts,
      ).toMatchObject({
        mergedPrs: 1,
        releasing: true,
        heldReason: 'migration',
      });
    });
  });

  describe('Shipped', () => {
    it('is launching straight after release, then measuring, then learned', () => {
      const shipped = (over: Partial<PlanStageFacts>) =>
        derive({
          opportunity: opp({ releasedAt: '2026-11-14T00:00:00.000Z' }),
          plan: plan({
            leadUserId: 7,
            buildStarted: true,
            shipped: true,
            ...over,
          }),
        }).statusParts;
      expect(shipped({})).toMatchObject({
        stage: 'shipped',
        step: 'launching',
      });
      expect(shipped({ launched: true, reviewsDue: 2 })).toMatchObject({
        step: 'measuring',
      });
      expect(
        shipped({ launched: true, reviewsDue: 2, reviewsDone: 2 }),
      ).toMatchObject({ step: 'learned' });
    });

    it('is shipped when the legacy stage says released, with its release date', () => {
      expect(
        derive({
          opportunity: opp({
            stage: 'released',
            releasedAt: '2026-11-14T00:00:00.000Z',
          }),
        }),
      ).toEqual({
        shownStage: 'shipped',
        statusParts: {
          stage: 'shipped',
          step: null,
          liveSince: '2026-11-14T00:00:00.000Z',
          outcomeReviewAt: null,
          outcome: null,
        },
      });
    });

    it('trusts release facts over the row, and a plan behind the release is launching', () => {
      expect(
        derive({
          opportunity: opp({ stage: 'released' }),
          plan: plan({ leadUserId: 7, buildStarted: true }),
          shipped: {
            liveSince: '2026-11-15T00:00:00.000Z',
            outcomeReviewAt: '2026-12-15T00:00:00.000Z',
            outcome: { hitTarget: true },
          },
        }).statusParts,
      ).toEqual({
        stage: 'shipped',
        step: 'launching',
        liveSince: '2026-11-15T00:00:00.000Z',
        outcomeReviewAt: '2026-12-15T00:00:00.000Z',
        outcome: { hitTarget: true },
      });
    });
  });

  describe('Closed', () => {
    it('is closed as not pursuing when the plan was closed', () => {
      expect(
        derive({
          plan: {
            ...plan({ leadUserId: 7, closed: true }),
            closedBy: 7,
            closedAt: '2026-11-12T00:00:00.000Z',
          },
        }),
      ).toEqual({
        shownStage: 'closed',
        statusParts: {
          stage: 'closed',
          reason: 'not_pursuing',
          byUserId: 7,
          at: '2026-11-12T00:00:00.000Z',
        },
      });
    });

    it('is closed (archived) for a legacy archived row', () => {
      expect(
        derive({ opportunity: opp({ stage: 'archived' }) }).statusParts,
      ).toEqual({
        stage: 'closed',
        reason: 'archived',
        byUserId: null,
        at: null,
      });
    });

    it('wins over a release', () => {
      expect(
        derive({
          opportunity: opp({ stage: 'released' }),
          plan: plan({ closed: true, shipped: true }),
        }).shownStage,
      ).toBe('closed');
    });
  });

  describe('legacy ideas with no plan session', () => {
    it.each([
      ['new', 'accepted'],
      ['prioritised', 'accepted'],
      ['released', 'shipped'],
      ['archived', 'closed'],
    ] as const)('stage %s shows as %s', (stage, shown) => {
      expect(derive({ opportunity: opp({ stage }) }).shownStage).toBe(shown);
    });

    it('is planning once a Builder session was opened from it', () => {
      expect(
        derive({ legacySession: { buildStarted: false } }).statusParts,
      ).toMatchObject({ stage: 'planning', step: 'prd', leadUserId: null });
    });

    it('is building once that session has run a build', () => {
      expect(derive({ legacySession: { buildStarted: true } }).shownStage).toBe(
        'building',
      );
    });

    it('ignores a legacy session when a plan session exists', () => {
      expect(
        derive({ plan: plan(), legacySession: { buildStarted: true } })
          .shownStage,
      ).toBe('accepted');
    });
  });
});

import type { ShownStage } from '../plan-stage.util';
import {
  capabilitiesFor,
  editCapabilitiesFor,
  globalCapabilities,
  NO_CAPABILITIES,
  RoadmapCapabilities,
  RoadmapCapabilityItem,
  RoadmapRelationship,
  RoadmapRole,
  roleAtLeast,
  roleFromGrants,
} from '../roadmap-role.util';

const ROLES: RoadmapRole[] = ['none', 'viewer', 'idea', 'builder', 'owner'];
const STAGES: ShownStage[] = [
  'draft',
  'submitted',
  'accepted',
  'planning',
  'building',
  'shipped',
  'declined',
  'closed',
];
const KEYS = Object.keys(NO_CAPABILITIES) as (keyof RoadmapCapabilities)[];

const item = (
  over: Partial<RoadmapCapabilityItem> = {},
): RoadmapCapabilityItem => ({
  shownStage: 'accepted',
  hasLead: false,
  hasPlan: true,
  planningStarted: false,
  planClosed: false,
  designAwaitingApproval: false,
  readyToBuild: false,
  awaitingMerge: false,
  releaseHeld: false,
  answersConflict: false,
  ...over,
});
const stranger: RoadmapRelationship = {
  isAuthor: false,
  isLead: false,
  isWatcher: false,
};
const author = { ...stranger, isAuthor: true };
const lead = { ...stranger, isLead: true };

const can = (
  role: RoadmapRole,
  rel: RoadmapRelationship,
  over: Partial<RoadmapCapabilityItem>,
) => capabilitiesFor(role, rel, item(over));

/** Every combination of relationship and item flag, for the sweeps below. */
function* everyCase(): Generator<[RoadmapRelationship, RoadmapCapabilityItem]> {
  const bools = [false, true];
  for (const shownStage of STAGES)
    for (const isAuthor of bools)
      for (const isLead of bools)
        for (const hasLead of bools)
          for (const flag of bools)
            yield [
              { isAuthor, isLead, isWatcher: false },
              item({
                shownStage,
                hasLead: hasLead || isLead,
                planningStarted: flag,
                planClosed: flag,
                designAwaitingApproval: flag,
                readyToBuild: flag,
                awaitingMerge: flag,
                releaseHeld: flag,
                answersConflict: flag,
              }),
            ];
}

describe('roleFromGrants (day-one mapping, §3.3)', () => {
  const grants = (over: Partial<Parameters<typeof roleFromGrants>[0]>) =>
    roleFromGrants({
      roadmap: false,
      builder: false,
      manage: false,
      restricted: false,
      ...over,
    });

  it('maps product_roadmap → Idea, builder → Builder, manage → Owner', () => {
    expect(grants({})).toBe('none');
    expect(grants({ roadmap: true })).toBe('idea');
    expect(grants({ roadmap: true, builder: true })).toBe('builder');
    expect(grants({ roadmap: true, builder: true, manage: true })).toBe(
      'owner',
    );
  });

  it('nests: the highest grant wins even without the lower ones', () => {
    expect(grants({ builder: true })).toBe('builder');
    expect(grants({ manage: true })).toBe('owner');
  });

  it('makes an org-restricted admin a Viewer at most', () => {
    expect(grants({ restricted: true })).toBe('none');
    expect(grants({ restricted: true, roadmap: true })).toBe('viewer');
    expect(
      grants({ restricted: true, roadmap: true, builder: true, manage: true }),
    ).toBe('viewer');
  });

  it('orders roles', () => {
    expect(roleAtLeast('owner', 'builder')).toBe(true);
    expect(roleAtLeast('builder', 'idea')).toBe(true);
    expect(roleAtLeast('idea', 'builder')).toBe(false);
    expect(roleAtLeast('viewer', 'idea')).toBe(false);
  });
});

describe('capabilitiesFor (§3.1 matrix)', () => {
  it('gives None nothing at all', () => {
    for (const [rel, it] of everyCase()) {
      expect(capabilitiesFor('none', rel, it)).toEqual(NO_CAPABILITIES);
    }
  });

  it('is monotone: a higher role can do everything a lower one can', () => {
    for (const [rel, it] of everyCase()) {
      for (let i = 1; i < ROLES.length; i++) {
        const lower = capabilitiesFor(ROLES[i - 1], rel, it);
        const higher = capabilitiesFor(ROLES[i], rel, it);
        for (const key of KEYS) {
          if (lower[key])
            expect([ROLES[i], key, higher[key]]).toEqual([ROLES[i], key, true]);
        }
      }
    }
  });

  it('makes Declined and Closed read-only for everyone (§4.7)', () => {
    for (const [rel, it] of everyCase()) {
      if (it.shownStage !== 'declined' && it.shownStage !== 'closed') continue;
      for (const role of ROLES) {
        const caps = capabilitiesFor(role, rel, it);
        const acting = KEYS.filter(
          (k) => caps[k] && !['watch', 'configure', 'pinView'].includes(k),
        );
        expect([role, it.shownStage, acting]).toEqual([
          role,
          it.shownStage,
          [],
        ]);
      }
    }
  });

  it('keeps a draft to its author: no votes, comments or curation', () => {
    for (const role of ROLES) {
      const other = can(role, stranger, { shownStage: 'draft' });
      expect(other.vote || other.comment || other.answer || other.submit).toBe(
        false,
      );
      expect(other.close || other.star || other.watch).toBe(false);
    }
    expect(can('idea', author, { shownStage: 'draft' })).toMatchObject({
      submit: true,
      answer: true,
      vote: false,
    });
    expect(can('viewer', author, { shownStage: 'draft' }).submit).toBe(false);
  });

  describe('Viewer', () => {
    it('sees, votes and comments; nothing else (D12, D17)', () => {
      const caps = can('viewer', stranger, { shownStage: 'submitted' });
      expect(KEYS.filter((k) => caps[k])).toEqual(['vote', 'comment']);
    });
  });

  describe('Idea', () => {
    it('votes, comments, answers and watches any shared idea (D2, D13)', () => {
      for (const shownStage of [
        'submitted',
        'accepted',
        'planning',
        'building',
      ] as ShownStage[]) {
        expect(can('idea', stranger, { shownStage })).toMatchObject({
          vote: shownStage !== 'building',
          comment: true,
          answer: true,
          watch: true,
        });
      }
    });

    it('votes only while it is in To do: a builder locks the votes', () => {
      expect(can('idea', stranger, { shownStage: 'planning' }).vote).toBe(true);
      expect(
        can('idea', stranger, { shownStage: 'planning', hasLead: true }).vote,
      ).toBe(false);
      expect(
        can('idea', stranger, { shownStage: 'building', hasLead: true }).vote,
      ).toBe(false);
    });

    it('stops voting once shipped but can still comment', () => {
      expect(can('idea', stranger, { shownStage: 'shipped' })).toMatchObject({
        vote: false,
        comment: true,
      });
    });

    it('settles conflicting answers as the author only before a lead exists', () => {
      expect(
        can('idea', author, { answersConflict: true, hasLead: false })
          .settleAnswer,
      ).toBe(true);
      expect(
        can('idea', author, { answersConflict: true, hasLead: true })
          .settleAnswer,
      ).toBe(false);
      expect(
        can('idea', stranger, { answersConflict: true }).settleAnswer,
      ).toBe(false);
    });

    it('has no build controls even on an idea it wrote', () => {
      const caps = can('idea', author, {
        shownStage: 'planning',
        readyToBuild: true,
        designAwaitingApproval: true,
      });
      expect(caps).toMatchObject({
        startPlanning: false,
        approveDesign: false,
        startBuild: false,
        raiseCeiling: false,
        close: false,
        exportBrief: false,
      });
    });
  });

  describe('Builder', () => {
    // An idea a Builder was assigned to build: it has a lead, and it is them.
    const assigned = { hasLead: true };

    it('makes the build calls only on ideas it was assigned to build', () => {
      const ready = {
        ...assigned,
        shownStage: 'planning' as const,
        readyToBuild: true,
      };
      expect(can('builder', lead, ready).startBuild).toBe(true);
      expect(can('builder', stranger, ready).startBuild).toBe(false);
      const design = {
        ...assigned,
        shownStage: 'planning' as const,
        designAwaitingApproval: true,
      };
      expect(can('builder', lead, design).approveDesign).toBe(true);
      expect(can('builder', stranger, design).approveDesign).toBe(false);
      const merge = {
        ...assigned,
        shownStage: 'building' as const,
        awaitingMerge: true,
      };
      expect(can('builder', lead, merge).merge).toBe(true);
      expect(can('builder', stranger, merge).merge).toBe(false);
      const held = { shownStage: 'building' as const, releaseHeld: true };
      expect(can('builder', lead, held).release).toBe(true);
      expect(can('builder', stranger, held).release).toBe(false);
    });

    it("never expands an idea into a plan: that is the Owner's", () => {
      expect(can('builder', lead, assigned).startPlanning).toBe(false);
      expect(can('builder', stranger, {}).startPlanning).toBe(false);
      expect(
        can('builder', stranger, { shownStage: 'submitted' }).startPlanning,
      ).toBe(false);
    });

    it('never closes or reopens a plan', () => {
      expect(
        can('builder', stranger, { shownStage: 'planning' }).closePlan,
      ).toBe(false);
      expect(
        can('builder', stranger, { shownStage: 'planning', planClosed: true })
          .reopenPlan,
      ).toBe(false);
    });

    it('raises the ceiling only as the lead, and only when a plan exists', () => {
      expect(
        can('builder', lead, { shownStage: 'planning' }).raiseCeiling,
      ).toBe(true);
      expect(
        can('builder', stranger, { shownStage: 'planning' }).raiseCeiling,
      ).toBe(false);
      expect(
        can('builder', lead, { shownStage: 'planning', hasPlan: false })
          .raiseCeiling,
      ).toBe(false);
    });

    it('never declines, closes, reviews, assigns or stars', () => {
      const caps = can('builder', stranger, { shownStage: 'submitted' });
      expect(caps).toMatchObject({
        close: false,
        decline: false,
        review: false,
        pickLead: false,
        star: false,
        configure: false,
        pinView: false,
      });
    });

    it('cannot pick itself a lead (D11)', () => {
      expect(
        can('builder', stranger, {
          shownStage: 'planning',
          planClosed: true,
        }).pickLead,
      ).toBe(false);
    });

    it('chooses how it is built and sends the brief, on its own idea once assigned', () => {
      for (const shownStage of ['planning', 'building'] as const) {
        expect(can('builder', lead, { ...assigned, shownStage })).toMatchObject(
          { setBuildMode: true, exportBrief: true },
        );
        expect(
          can('builder', stranger, { hasLead: true, shownStage }),
        ).toMatchObject({ setBuildMode: false, exportBrief: false });
      }
    });

    it("marks its own idea Released, and no one else's", () => {
      expect(
        can('builder', lead, { ...assigned, shownStage: 'building' })
          .markReleased,
      ).toBe(true);
      expect(
        can('builder', stranger, { hasLead: true, shownStage: 'building' })
          .markReleased,
      ).toBe(false);
      expect(
        can('builder', lead, { ...assigned, shownStage: 'shipped' })
          .markReleased,
      ).toBe(false);
    });
  });

  describe('Owner', () => {
    it('reviews only what is awaiting review (D10)', () => {
      expect(can('owner', stranger, { shownStage: 'submitted' }).review).toBe(
        true,
      );
      expect(can('owner', stranger, { shownStage: 'accepted' }).review).toBe(
        false,
      );
    });

    it('expands a submitted or accepted idea into a plan, once', () => {
      expect(
        can('owner', stranger, { shownStage: 'submitted' }).startPlanning,
      ).toBe(true);
      expect(can('owner', stranger, {}).startPlanning).toBe(true);
      expect(
        can('owner', stranger, { planningStarted: true }).startPlanning,
      ).toBe(false);
      expect(
        can('owner', stranger, { shownStage: 'planning' }).startPlanning,
      ).toBe(false);
    });

    it('closes the plan while planning with no builder, and reopens it until one is assigned', () => {
      expect(can('owner', stranger, { shownStage: 'planning' })).toMatchObject({
        closePlan: true,
        reopenPlan: false,
      });
      expect(
        can('owner', stranger, { shownStage: 'planning', planClosed: true }),
      ).toMatchObject({ closePlan: false, reopenPlan: true });
      expect(
        can('owner', stranger, {
          shownStage: 'planning',
          planClosed: true,
          hasLead: true,
        }),
      ).toMatchObject({ closePlan: false, reopenPlan: false });
    });

    it('assigns a builder only once the plan is closed, and can always change one', () => {
      for (const shownStage of STAGES) {
        const open = !['draft', 'shipped', 'declined', 'closed'].includes(
          shownStage,
        );
        expect([
          shownStage,
          can('owner', stranger, { shownStage }).pickLead,
          can('owner', stranger, { shownStage, planClosed: true }).pickLead,
          can('owner', stranger, { shownStage, hasLead: true }).pickLead,
        ]).toEqual([shownStage, false, open, open]);
      }
    });

    it('declines at any point before Released', () => {
      for (const shownStage of STAGES) {
        expect([
          shownStage,
          can('owner', stranger, { shownStage }).decline,
        ]).toEqual([
          shownStage,
          ['submitted', 'accepted', 'planning', 'building'].includes(
            shownStage,
          ),
        ]);
      }
    });

    it('does everything the builder can, on any idea (§2.1a)', () => {
      expect(
        can('owner', stranger, {
          shownStage: 'planning',
          readyToBuild: true,
          hasLead: true,
        }).startBuild,
      ).toBe(true);
      expect(
        can('owner', stranger, { shownStage: 'planning' }).raiseCeiling,
      ).toBe(true);
      expect(
        can('owner', stranger, { shownStage: 'building' }).markReleased,
      ).toBe(true);
    });

    it('starts no build before a builder is assigned', () => {
      expect(
        can('owner', stranger, { shownStage: 'planning', readyToBuild: true })
          .startBuild,
      ).toBe(false);
    });

    it('stars, pins views and configures', () => {
      expect(can('owner', stranger, { shownStage: 'submitted' })).toMatchObject(
        { star: true, pinView: true, configure: true },
      );
      expect(can('owner', stranger, { shownStage: 'draft' }).star).toBe(false);
    });
  });

  it('answers me/role with the global switches', () => {
    expect(globalCapabilities('owner')).toEqual({
      configure: true,
      pinView: true,
      review: true,
      submit: true,
    });
    expect(globalCapabilities('builder')).toEqual({
      configure: false,
      pinView: false,
      review: false,
      submit: true,
    });
    expect(globalCapabilities('viewer').submit).toBe(false);
  });
});

describe('editCapabilitiesFor (§4.11)', () => {
  const none = { isAuthor: false, isLead: false };
  const author = { isAuthor: true, isLead: false };
  const lead = { isAuthor: false, isLead: true };

  it('locks the idea to everyone but an Owner once it is submitted', () => {
    for (const stage of [
      'submitted',
      'accepted',
      'planning',
      'building',
    ] as const) {
      expect(
        Object.values(editCapabilitiesFor('idea', author, stage)).some(Boolean),
      ).toBe(false);
      expect(
        Object.values(editCapabilitiesFor('builder', lead, stage)).some(
          Boolean,
        ),
      ).toBe(false);
    }
  });

  it('gives an Owner the lead only once the plan is closed or a builder exists', () => {
    expect(editCapabilitiesFor('owner', none, 'planning').editLead).toBe(false);
    expect(
      editCapabilitiesFor('owner', none, 'planning', {
        planClosed: true,
        hasLead: false,
      }).editLead,
    ).toBe(true);
    expect(
      editCapabilitiesFor('owner', none, 'building', {
        planClosed: false,
        hasLead: true,
      }).editLead,
    ).toBe(true);
  });

  it('gives an Owner the text, the month and the size; the month stops at Shipped, the size does not', () => {
    expect(
      editCapabilitiesFor('owner', none, 'accepted', {
        planClosed: true,
        hasLead: false,
      }),
    ).toEqual({
      editTitle: true,
      editGoal: true,
      editSummary: true,
      editLead: true,
      editMonth: true,
      editSize: true,
    });
    expect(editCapabilitiesFor('owner', none, 'shipped')).toMatchObject({
      editLead: false,
      editMonth: false,
      editTitle: true,
      editSize: true,
    });
  });

  it('makes Declined, Closed and drafts read-only, and Viewers never edit', () => {
    for (const stage of ['declined', 'closed', 'draft'] as const) {
      expect(
        Object.values(editCapabilitiesFor('owner', author, stage)).some(
          Boolean,
        ),
      ).toBe(false);
    }
    expect(
      Object.values(editCapabilitiesFor('viewer', author, 'submitted')).some(
        Boolean,
      ),
    ).toBe(false);
  });
});

import { PlanStage } from '../../enum/product-planning.enum';
import { derivePlanStage, PlanStageFacts } from '../plan-stage.util';

const base: PlanStageFacts = {
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
};
const stage = (over: Partial<PlanStageFacts>) =>
  derivePlanStage({ ...base, ...over });

describe('derivePlanStage', () => {
  it('walks the whole lifecycle in order', () => {
    expect(stage({ private: true })).toBe(PlanStage.IDEA);
    expect(stage({})).toBe(PlanStage.FILED);
    expect(stage({ leadUserId: 4 })).toBe(PlanStage.PRD);
    expect(stage({ leadUserId: 4, prdReady: true })).toBe(PlanStage.DESIGN);
    expect(stage({ prdReady: true, designApproved: true })).toBe(
      PlanStage.READY,
    );
    expect(stage({ designApproved: true, buildStarted: true })).toBe(
      PlanStage.BUILDING,
    );
    expect(stage({ buildStarted: true, shipped: true })).toBe(
      PlanStage.LAUNCHING,
    );
    expect(
      stage({ shipped: true, launched: true, reviewsDue: 2, reviewsDone: 1 }),
    ).toBe(PlanStage.MEASURING);
    expect(
      stage({ shipped: true, launched: true, reviewsDue: 2, reviewsDone: 2 }),
    ).toBe(PlanStage.LEARNED);
  });

  it('keeps a closed plan closed whatever else is true', () => {
    expect(stage({ closed: true, shipped: true, launched: true })).toBe(
      PlanStage.CLOSED,
    );
  });

  it('keeps a private session an idea even if a lead or readiness leaked in', () => {
    expect(stage({ private: true, leadUserId: 3, prdReady: true })).toBe(
      PlanStage.IDEA,
    );
  });

  it('measures, rather than declares learned, when no review is scheduled yet', () => {
    expect(stage({ shipped: true, launched: true })).toBe(PlanStage.MEASURING);
  });
});

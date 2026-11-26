import { RoadmapOpportunityStage } from '../../enum/roadmap-opportunity.enum';
import {
  effectiveMonthOf,
  isMonthPinned,
  monthKeyOf,
} from '../../util/roadmap-month.util';

const { NEW, PRIORITISED, RELEASED, ARCHIVED } = RoadmapOpportunityStage;

describe('monthKeyOf', () => {
  it('formats YYYY-MM zero-padded, on the UTC month', () => {
    expect(monthKeyOf(new Date('2026-09-15T12:00:00Z'))).toBe('2026-09');
    expect(monthKeyOf(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
    // THE BUG THIS PREVENTS: '2026-9' fails CHK_roadmap_opps_planned_month outright.
    expect(monthKeyOf(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });
});

describe('isMonthPinned', () => {
  it('pins only a released opportunity that actually has a release timestamp', () => {
    expect(isMonthPinned(RELEASED, new Date('2026-05-04T00:00:00Z'))).toBe(
      true,
    );
  });

  it('does not pin an unreleased opportunity even if one somehow carries a timestamp', () => {
    expect(isMonthPinned(NEW, new Date('2026-05-04T00:00:00Z'))).toBe(false);
    expect(isMonthPinned(PRIORITISED, new Date('2026-05-04T00:00:00Z'))).toBe(
      false,
    );
    expect(isMonthPinned(ARCHIVED, new Date('2026-05-04T00:00:00Z'))).toBe(
      false,
    );
  });

  it('does NOT pin a released row with a null releasedAt', () => {
    // THE BUG THIS PREVENTS: ~173 of the 280 rows migrated from the standalone app are released
    // with a NULL releasedAt, because the source trigger also only fired on transition and
    // nothing may backfill it. Pinning those would make them permanently undraggable AND strand
    // them in a lane that cannot be computed.
    expect(isMonthPinned(RELEASED, null)).toBe(false);
    expect(isMonthPinned(RELEASED, undefined)).toBe(false);
  });
});

describe('effectiveMonthOf', () => {
  it('uses the planned month while the opportunity has not shipped', () => {
    expect(effectiveMonthOf(NEW, null, '2026-09')).toBe('2026-09');
    expect(effectiveMonthOf(PRIORITISED, null, '2026-09')).toBe('2026-09');
  });

  it('uses the RELEASE month once shipped, overriding the plan', () => {
    // This is the whole point of the two fields: planned for March, shipped in May, and the board
    // shows May while plannedMonth still remembers March. Overwriting the plan on release would
    // erase exactly the slip the board exists to surface.
    expect(
      effectiveMonthOf(RELEASED, new Date('2026-05-20T09:00:00Z'), '2026-03'),
    ).toBe('2026-05');
  });

  it('falls back to the planned month for a released row with no timestamp', () => {
    expect(effectiveMonthOf(RELEASED, null, '2026-03')).toBe('2026-03');
  });

  it('returns null — the Unscheduled lane — when there is nothing to go on', () => {
    expect(effectiveMonthOf(NEW, null, null)).toBeNull();
    expect(effectiveMonthOf(NEW, null, undefined)).toBeNull();
    expect(effectiveMonthOf(RELEASED, null, null)).toBeNull();
  });

  it('reads the release month in UTC, matching the SQL that groups the lanes', () => {
    // EFFECTIVE_MONTH_SQL uses to_char on a timestamp without time zone, i.e. no conversion.
    // If this function drifted onto local time, a card released late on the last day of a month
    // would appear in a different lane than the one the grouping query put it in.
    expect(
      effectiveMonthOf(RELEASED, new Date('2026-05-31T23:30:00Z'), null),
    ).toBe('2026-05');
    expect(
      effectiveMonthOf(RELEASED, new Date('2026-06-01T00:30:00Z'), null),
    ).toBe('2026-06');
  });
});

import {
  DebriefScoreService,
  SCORE_COMPARE_MIN_DEBRIEFS,
} from '../service/debrief-score.service';
import { defaultOwnerSettings } from '../constants/debrief-owner-settings.constants';

const DAY = 86_400_000;
const NOW = new Date('2026-11-16T18:00:00Z');

/** One judged, published live run `daysAgo` days before NOW. */
const run = (i: number, daysAgo: number, quality: number) => ({
  id: `r${i}`,
  createdAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
  status: 'published',
  releaseId: null,
  week: '2026-11-16',
  language: 'en-IN',
  recipe: 'standard',
  has_cards: true,
  check_failures: [],
  judged: true,
  quality,
  hard_fails: [],
  missed_clear: false,
  session_cost: 0.1,
  up: null,
  down: null,
  flagged: false,
});

function svc(rows: Array<Record<string, unknown>>) {
  const query = jest.fn(async (sql: string) =>
    sql.includes('FROM debrief_runs r') ? rows : [],
  );
  return new DebriefScoreService(
    { query } as any,
    { get: jest.fn(async () => defaultOwnerSettings()) } as any,
    { getGa: jest.fn(async () => null) } as any,
  );
}

describe('the overall score compares weeks only with enough debriefs (prod 2026-11-16)', () => {
  it('2 debriefs last week against 56 this week: no previous score', async () => {
    const rows = [
      run(1, 9, 10),
      run(2, 10, 9.9),
      ...Array.from({ length: 56 }, (_, i) => run(100 + i, 2, 8.9)),
    ];
    const view = await svc(rows).view(14, NOW);
    expect(view.current).not.toBeNull();
    expect(view.previous).toBeNull();
  });

  it('enough debriefs in both weeks: compared', async () => {
    const n = SCORE_COMPARE_MIN_DEBRIEFS;
    const rows = [
      ...Array.from({ length: n }, (_, i) => run(i, 9, 9.5)),
      ...Array.from({ length: n }, (_, i) => run(100 + i, 2, 8.9)),
    ];
    const view = await svc(rows).view(14, NOW);
    expect(view.previous).not.toBeNull();
  });
});

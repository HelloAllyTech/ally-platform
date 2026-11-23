import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';
import {
  ASK_ALLY_COST_TARGET_USD,
  DebriefMetricsService,
} from '../service/debrief-metrics.service';

/** PRD: an Ask Ally reply costs at most $0.05 — priced from the replies' own model calls. */
describe('Ask Ally cost per reply', () => {
  const make = (rows: Array<{ model: string; p: number; c: number }>) => {
    const query = jest.fn().mockResolvedValue(rows);
    const svc = new DebriefMetricsService({ query } as any, {} as any);
    return { svc: svc as any, query };
  };

  it('prices the window’s Ask Ally calls and divides by the replies sent', async () => {
    const rows = [
      { model: 'gemini-2.5-flash', p: 400_000, c: 40_000 },
      { model: 'gemini-3-flash-preview', p: 100_000, c: 10_000 },
    ];
    const { svc, query } = make(rows);
    const out = await svc.askAllyCost(13, ` AND r.language = 'hi-IN'`, 20);
    const spend = rows.reduce(
      (n, r) => n + computeCostUsd(r.model, r.p, r.c).costUsd,
      0,
    );
    expect(out.spendUsd).toBeCloseTo(spend, 10);
    expect(out.costPerReplyMean).toBeCloseTo(spend / 20, 10);
    expect(out.costPerReplyTarget).toBe(ASK_ALLY_COST_TARGET_USD);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(`lu.task = 'debrief_reply'`);
    expect(sql).toContain(`AND r.language = 'hi-IN'`);
    expect(params).toEqual([12]);
  });

  it('has no cost per reply when there were no replies', async () => {
    const { svc } = make([]);
    const out = await svc.askAllyCost(13, '', 0);
    expect(out.spendUsd).toBe(0);
    expect(out.costPerReplyMean).toBeNull();
  });
});

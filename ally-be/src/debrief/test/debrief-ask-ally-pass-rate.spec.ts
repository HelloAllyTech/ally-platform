import { DebriefMetricsService } from '../service/debrief-metrics.service';

/**
 * Only replaced replies get a verdict until an Ask Ally judge exists, and they all fail. A rate
 * over those alone read 0% (0 of 7) in prod; the rate stays unmeasured until every reply is scored.
 */
describe('Ask Ally pass rate', () => {
  const make = (counts: { replies: number; replaced: number }) => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { ...counts, questions: 0, distress_flags: 0, calls: 0 },
      ])
      .mockResolvedValue([]);
    return new DebriefMetricsService({ query } as any, {} as any) as any;
  };

  it('is not measured while clean replies have no verdict', async () => {
    const out = await make({ replies: 27, replaced: 7 }).askAlly(13);
    expect(out.passRate).toBeNull();
    expect(out.checkPassRate).toMatchObject({ n: 20, of: 27 });
  });

  it('is not measured with no replies', async () => {
    const out = await make({ replies: 0, replaced: 0 }).askAlly(13);
    expect(out.passRate).toBeNull();
  });
});

import { successMeasureGaps } from 'src/product-planning/util/plan-readiness.util';
import { normaliseSuccessMeasure } from '../builder-success-measure-tool.util';

describe('normaliseSuccessMeasure', () => {
  it('needs a metric and a target', () => {
    expect(normaliseSuccessMeasure({ metric: 'x' })).toEqual({
      error: 'metric and target are both required.',
    });
  });

  it('stores a complete measure the plan readiness accepts', () => {
    const out = normaliseSuccessMeasure({
      metric: ' Next-day return ',
      target: '52%',
      guardrails: 'Opt-outs',
      method: { kind: 'analytics_question', spec: 'Share returning next day' },
      reviewAfterDays: ['45', 14, 14, 0, 900],
    });
    expect('measure' in out).toBe(true);
    if (!('measure' in out)) return;
    expect(out.measure).toEqual({
      metric: 'Next-day return',
      baseline: null,
      target: '52%',
      guardrails: ['Opt-outs'],
      method: { kind: 'analytics_question', spec: 'Share returning next day' },
      reviewAfterDays: [14, 45],
    });
    expect(successMeasureGaps(out.measure)).toEqual([]);
  });

  it('defaults an unknown method kind to manual', () => {
    const out = normaliseSuccessMeasure({
      metric: 'm',
      target: 't',
      method: { kind: 'magic', spec: 's' },
    });
    expect('measure' in out && out.measure.method.kind).toBe('manual');
  });
});

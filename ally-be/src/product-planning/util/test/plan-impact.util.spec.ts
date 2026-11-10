import { mergeImpactTags, tagsForPaths } from '../plan-impact.util';
import { requiredChecks, successMeasureGaps } from '../plan-readiness.util';

describe('impact tags and required checks', () => {
  it('tags sensitive code paths', () => {
    const tags = tagsForPaths([
      'ally-be/src/guide/safety/sentinel.ts',
      'ally-web/apps/ally-admin-dashboard/src/pages/X.tsx',
      'ally-be/src/prompts/foo.txt',
    ]).map((t) => t.id);
    expect(tags).toEqual(
      expect.arrayContaining([
        'crisis_or_helpline_path',
        'ui_change',
        'prompt_or_model_change',
      ]),
    );
  });

  it('never lets a lead remove a tag code found', () => {
    const code = tagsForPaths(['ally-be/src/helpline/x.ts']);
    const merged = mergeImpactTags(code, [], [], 7);
    expect(merged.map((t) => t.id)).toEqual(['crisis_or_helpline_path']);
    const withLead = mergeImpactTags(merged, ['mobile'], [], 7);
    expect(withLead.map((t) => [t.id, t.source])).toEqual([
      ['crisis_or_helpline_path', 'code'],
      ['mobile', 'lead'],
    ]);
  });

  it('requires checks from tags, in code', () => {
    expect(requiredChecks(['crisis_or_helpline_path'])).toEqual(['safety']);
    expect(requiredChecks(['sends_user_content_to_llm'])).toEqual(['privacy']);
    expect(requiredChecks(['learner_or_client_facing_ai'])).toEqual([
      'safety',
      'ai_quality',
    ]);
    expect(requiredChecks(['ui_change', 'mobile'])).toEqual([]);
  });

  it('names what a success measure still lacks', () => {
    expect(successMeasureGaps(null)).toHaveLength(1);
    expect(
      successMeasureGaps({
        metric: '7-day re-entry rate',
        baseline: null,
        target: '37%',
        guardrails: ['session length'],
        method: { kind: 'analytics_question', spec: 'What share of learners…' },
        reviewAfterDays: [14, 45],
      }),
    ).toEqual([]);
    expect(
      successMeasureGaps({
        metric: 'x',
        baseline: null,
        target: '',
        guardrails: [],
        method: { kind: 'manual', spec: '' },
        reviewAfterDays: [],
      }),
    ).toHaveLength(4);
  });
});

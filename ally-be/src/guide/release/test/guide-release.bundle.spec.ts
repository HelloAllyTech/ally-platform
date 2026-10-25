import { computeCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { LLM_MODEL_REGISTRY } from 'src/llm/constants/llm-model-registry.constants';
import { canonicalHash } from 'src/llm-agent/harness/release/canonical-hash.util';
import { GUIDE_DEFAULT_BUNDLE } from '../guide-release.bundle';

describe('GUIDE_DEFAULT_BUNDLE', () => {
  const routes = Object.values(GUIDE_DEFAULT_BUNDLE.modelRouting).flatMap(
    (byChannel) =>
      Object.values(byChannel ?? {}).flatMap((byTier) =>
        Object.values(byTier ?? {}),
      ),
  );

  it('routes every role to a catalogued model', () => {
    const catalogued = new Set(LLM_MODEL_REGISTRY.map((m) => m.model));
    for (const route of routes) {
      expect(catalogued.has(route!.model)).toBe(true);
    }
  });

  it('routes every role to a priced model, so the cost ledger never reads $0', () => {
    for (const route of routes) {
      expect(computeCostUsd(route!.model, 1000, 1000).priced).toBe(true);
    }
  });

  it('routes no role to Anthropic by default, since production has no funded key for it', () => {
    expect(routes.filter((route) => route!.provider === 'anthropic')).toEqual(
      [],
    );
  });

  it('keeps the critic and the verifier in different model families', () => {
    const { evaluator_critic, evaluator_verifier } =
      GUIDE_DEFAULT_BUNDLE.modelRouting;
    expect(evaluator_critic?.text?.premium?.provider).not.toBe(
      evaluator_verifier?.text?.premium?.provider,
    );
  });

  it('keeps the budget ladder in order: lite ≤ degraded ≤ premium', () => {
    const { threadSoftCapUsd, threadLiteCapUsd } =
      GUIDE_DEFAULT_BUNDLE.policy.limits;
    expect(threadSoftCapUsd).toBeLessThan(threadLiteCapUsd);
  });

  it('hashes stably, so a seed on two instances is the same release', () => {
    expect(canonicalHash(GUIDE_DEFAULT_BUNDLE)).toBe(
      canonicalHash(JSON.parse(JSON.stringify(GUIDE_DEFAULT_BUNDLE))),
    );
  });
});

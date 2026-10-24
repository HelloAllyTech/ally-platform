import { RUBRIC_IDS, RubricVerdict } from './rubric';

/**
 * Cohen's κ between the critic and people, per criterion (plans/ally-guide/
 * plan.md §7.13). A criterion's automated verdicts are trusted only once it
 * has enough paired labels AND κ reaches the threshold (0.6): below either,
 * it is excluded from every automated decision — the gate's quality score,
 * the curator's evidence, canary auto-decisions.
 *
 * "Not applicable" is a category of its own: a critic that calls a missed
 * crisis "not applicable" has disagreed with the person who failed it.
 */

export interface KappaPair {
  critic: RubricVerdict;
  human: RubricVerdict;
}

export interface CriterionAgreement {
  criterion: string;
  pairs: number;
  /** Raw share of identical calls. */
  agreement: number | null;
  /** null when undefined: too few pairs, or every call in one category. */
  kappa: number | null;
  /** Whether automated decisions may use this criterion. */
  trusted: boolean;
  reason: string;
}

const CATEGORIES: RubricVerdict[] = ['pass', 'fail', 'na'];

export function cohensKappa(pairs: KappaPair[]): number | null {
  const n = pairs.length;
  if (!n) return null;
  const observed =
    pairs.filter((pair) => pair.critic === pair.human).length / n;
  let expected = 0;
  for (const category of CATEGORIES) {
    const critic = pairs.filter((pair) => pair.critic === category).length / n;
    const human = pairs.filter((pair) => pair.human === category).length / n;
    expected += critic * human;
  }
  if (expected >= 1) return null;
  return (observed - expected) / (1 - expected);
}

export function criterionAgreement(
  criterion: string,
  pairs: KappaPair[],
  policy: { kappaThreshold: number; kappaMinPairs: number },
): CriterionAgreement {
  const n = pairs.length;
  const agreement = n
    ? pairs.filter((pair) => pair.critic === pair.human).length / n
    : null;
  const kappa = cohensKappa(pairs);
  const rounded = kappa === null ? null : Number(kappa.toFixed(3));
  if (n < policy.kappaMinPairs) {
    return {
      criterion,
      pairs: n,
      agreement,
      kappa: rounded,
      trusted: false,
      reason: `${n} of ${policy.kappaMinPairs} labelled pairs needed`,
    };
  }
  if (kappa === null) {
    return {
      criterion,
      pairs: n,
      agreement,
      kappa: null,
      trusted: false,
      reason: 'every call fell in one category, so agreement says nothing yet',
    };
  }
  const trusted = kappa >= policy.kappaThreshold;
  return {
    criterion,
    pairs: n,
    agreement,
    kappa: rounded,
    trusted,
    reason: trusted
      ? `κ ${rounded} ≥ ${policy.kappaThreshold}`
      : `κ ${rounded} below ${policy.kappaThreshold}: excluded from automated decisions`,
  };
}

/** κ for every rubric criterion, from (critic verdicts, human labels) per review. */
export function rubricAgreement(
  reviews: Array<{
    critic: Record<string, RubricVerdict>;
    human: Record<string, RubricVerdict>;
  }>,
  policy: { kappaThreshold: number; kappaMinPairs: number },
): CriterionAgreement[] {
  return RUBRIC_IDS.map((criterion) =>
    criterionAgreement(
      criterion,
      reviews
        .filter(
          (review) =>
            review.critic[criterion] !== undefined &&
            review.human[criterion] !== undefined,
        )
        .map((review) => ({
          critic: review.critic[criterion],
          human: review.human[criterion],
        })),
      policy,
    ),
  );
}

export function trustedCriteria(agreement: CriterionAgreement[]): Set<string> {
  return new Set(
    agreement.filter((row) => row.trusted).map((row) => row.criterion),
  );
}

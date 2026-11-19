import type { PlanSuccessMeasure } from 'src/product-planning/type/plan-record.type';

/**
 * The planning agent's tool for a plan's success measure (audit 2026-11-19,
 * rec 2). The measure lives on the plan (`builder_sessions.plan.successMeasure`),
 * not in the PRD, and until now only a route the Owner-led pages never call
 * could write it, so a PRD could read ready with nothing saying what should
 * move. Offered on plan sessions only.
 */
export const SET_SUCCESS_MEASURE_TOOL = {
  name: 'set_success_measure',
  description:
    "Write the plan's success measure: the metric that should move, its baseline (left out when " +
    'there is none yet), the target, the guardrails that must not get worse, how it is measured, ' +
    'and the days after release to review it. Replaces the whole measure. Use the words the ' +
    'planner agreed to; ask with ask_admin first when they have not said what success looks ' +
    'like. Not a PRD edit: say you set the success measure, not that the PRD changed. Refused ' +
    'once the design is approved and the measure is frozen.',
  input_schema: {
    type: 'object',
    properties: {
      metric: { type: 'string', description: 'The metric that should move' },
      baseline: {
        type: 'string',
        description:
          'Where it stands today. Leave it out when there is no baseline yet (then tracking ' +
          'becomes part of the first slice).',
      },
      target: { type: 'string', description: 'Where it should get to' },
      guardrails: {
        type: 'array',
        items: { type: 'string' },
        description: 'Metrics that must not get worse (1 to 5)',
      },
      method: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['analytics_question', 'manual'] },
          spec: {
            type: 'string',
            description:
              'The analytics question the outcome review re-asks, or how a person measures it',
          },
        },
        required: ['kind', 'spec'],
      },
      reviewAfterDays: {
        type: 'array',
        items: { type: 'number' },
        description: 'Days after release to review the outcome, e.g. [14, 45]',
      },
    },
    required: ['metric', 'target', 'guardrails', 'method', 'reviewAfterDays'],
  },
};

const TEXT_MAX = 300;
const SPEC_MAX = 1000;

const text = (value: unknown, max = TEXT_MAX): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

/**
 * The model's input as a stored measure, or what is wrong with it. Lenient
 * about shape (a lone guardrail string, day counts as strings), strict about
 * the two fields a measure is meaningless without.
 */
export function normaliseSuccessMeasure(
  input: Record<string, unknown> | null | undefined,
): { measure: PlanSuccessMeasure } | { error: string } {
  const raw = input ?? {};
  const metric = text(raw.metric);
  const target = text(raw.target);
  if (!metric || !target) {
    return { error: 'metric and target are both required.' };
  }
  const guardrails = (
    Array.isArray(raw.guardrails) ? raw.guardrails : [raw.guardrails]
  )
    .map((g) => text(g))
    .filter(Boolean)
    .slice(0, 5);
  const method = (raw.method ?? {}) as Record<string, unknown>;
  const days = [
    ...new Set(
      (Array.isArray(raw.reviewAfterDays) ? raw.reviewAfterDays : [])
        .map((d) => Math.round(Number(d)))
        .filter((d) => Number.isFinite(d) && d >= 1 && d <= 365),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, 4);
  const baseline =
    raw.baseline === null || raw.baseline === undefined
      ? null
      : text(raw.baseline) || null;
  return {
    measure: {
      metric,
      baseline,
      target,
      guardrails,
      method: {
        kind:
          method.kind === 'analytics_question'
            ? 'analytics_question'
            : 'manual',
        spec: text(method.spec, SPEC_MAX),
      },
      reviewAfterDays: days,
    },
  };
}

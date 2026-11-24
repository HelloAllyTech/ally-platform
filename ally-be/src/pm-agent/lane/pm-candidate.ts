import { AgentToolDefinition } from 'src/llm-agent/type/agent-llm.type';
import {
  PM_CARD_LIMITS,
  validateCardPayload,
} from '../dto/pm-card-payload.dto';
import {
  PmCardCategory,
  PmCardKind,
  PmCardSize,
  PmLane,
  PmQuestionScope,
  PmRepo,
  PmRiskLevel,
} from '../enum/pm-agent.enum';
import { PM_SUBMIT_TOOL } from '../constants/pm-agent-pipeline.constants';
import { PmCandidate } from '../pipeline/pm-pipeline.types';
import { PM_METRIC_KEYS, PM_METRIC_UNITS } from '../impact/metric-catalog';
import { ROADMAP_FILEABLE_EFFORTS } from 'src/product-roadmap/constants/product-roadmap.constants';

const str = { type: 'string' };
const strList = { type: 'array', items: str };

const RECOMMENDATION_SCHEMA = {
  type: 'object',
  description:
    'Required when kind = recommendation. Every limit is enforced by code: an over-long field discards the candidate.',
  properties: {
    title: {
      type: 'string',
      description: 'Imperative, outcome-first, at most 12 words.',
    },
    whyHeadline: {
      type: 'string',
      description:
        'At most 25 words, leading with the strongest number from a cited evidence item.',
    },
    change: {
      type: 'array',
      items: str,
      description: '1–3 bullets, at most 15 words each.',
    },
    problem: str,
    plan: {
      type: 'object',
      description:
        'Only steps, files, acceptanceCriteria, testPlan and defaultsChosen. size, risk, ' +
        'evidenceIds, opportunity and the rest sit beside plan, not inside it.',
      additionalProperties: false,
      properties: {
        steps: strList,
        files: {
          type: 'array',
          items: str,
          description: 'Repo-prefixed paths, e.g. "ally-be/src/…".',
        },
        acceptanceCriteria: strList,
        testPlan: strList,
        defaultsChosen: {
          type: 'array',
          items: str,
          description:
            'Every decision a builder would otherwise have to ask about, decided, with why.',
        },
      },
      required: [
        'steps',
        'files',
        'acceptanceCriteria',
        'testPlan',
        'defaultsChosen',
      ],
    },
    size: { type: 'string', enum: Object.values(PmCardSize) },
    risk: { type: 'string', enum: Object.values(PmRiskLevel) },
    riskWhy: str,
    rollbackNote: str,
    impactMetric: {
      type: 'object',
      properties: {
        name: str,
        direction: { type: 'string', enum: ['up', 'down'] },
      },
      required: ['name', 'direction'],
    },
    metricRef: {
      type: 'object',
      description:
        'Optional. The measurable-metric catalog entry the platform reads 14 and 30 days after ' +
        'release to judge this card. Only when it genuinely measures this change; otherwise omit.',
      properties: {
        source: { type: 'string', enum: [...PM_METRIC_KEYS] },
        params: {
          type: 'object',
          description:
            "Only the entry's own params (e.g. { task } for llm_* entries).",
        },
        unit: { type: 'string', enum: [...PM_METRIC_UNITS] },
        betterWhen: { type: 'string', enum: ['up', 'down'] },
      },
      required: ['source', 'betterWhen'],
    },
    alternativesDropped: strList,
    repos: {
      type: 'array',
      items: { type: 'string', enum: Object.values(PmRepo) },
    },
    evidenceIds: {
      type: 'array',
      items: str,
      description:
        'Ids of evidence items returned by tools IN THIS RUN. Nothing else may be cited.',
    },
    opportunity: {
      type: 'object',
      description:
        'The roadmap entry Accept files, exactly as written. It must pass the roadmap filing ' +
        'checklist in the "Filing to the roadmap" section.',
      properties: {
        description: {
          type: 'string',
          description:
            'Plain text, 80–1000 characters, goal first: who is affected, the pain or gain, ' +
            'what changes for them, then "Why it matters: …". A possible solution may follow ' +
            'the goal, never replace it.',
        },
        productGoal: {
          type: 'string',
          description:
            'Exactly one product goal NAME from the product_goals tool, copied verbatim.',
        },
        effort: {
          type: 'string',
          enum: [...ROADMAP_FILEABLE_EFFORTS],
          description: 'Roadmap shirt size of the whole opportunity.',
        },
      },
      required: ['description', 'productGoal', 'effort'],
    },
  },
  required: [
    'title',
    'whyHeadline',
    'change',
    'problem',
    'plan',
    'size',
    'risk',
    'riskWhy',
    'rollbackNote',
    'impactMetric',
    'alternativesDropped',
    'repos',
    'evidenceIds',
    'opportunity',
  ],
};

/**
 * Recommendation fields that belong beside `plan` (every top-level property except `plan` and
 * the names `plan` itself defines). Derived from the schema so a new field is covered for free.
 */
const PLAN_SIBLING_KEYS: readonly string[] = Object.keys(
  RECOMMENDATION_SCHEMA.properties,
).filter(
  (key) =>
    key !== 'plan' &&
    !(key in RECOMMENDATION_SCHEMA.properties.plan.properties),
);

/**
 * Models (gpt-5-mini in prod, 2026-11-24) nest the recommendation's own fields inside `plan`
 * — size, risk, evidenceIds, opportunity… — and keep doing it after the repair note, so every
 * candidate was discarded. Moving a misplaced field up is lossless: it only happens when the
 * top level does not already hold that field, and the moved value is validated like any other.
 */
export function hoistMisplacedPlanFields(
  body: Record<string, any>,
): Record<string, any> {
  const plan = body.plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return body;
  const nested = PLAN_SIBLING_KEYS.filter((key) => key in plan);
  if (!nested.length) return body;
  const nextPlan = { ...plan };
  const hoisted: Record<string, any> = {};
  for (const key of nested) {
    // The top level wins when the model wrote the field in both places (prod 2026-11-24:
    // `size` beside AND inside plan); the copy inside plan is dropped, never merged.
    if (!(key in body)) hoisted[key] = nextPlan[key];
    delete nextPlan[key];
  }
  return { ...body, ...hoisted, plan: nextPlan };
}

/** Recommendation lists the model sometimes sends as one string (prod: alternativesDropped). */
const TOP_LEVEL_LISTS = [
  'change',
  'alternativesDropped',
  'repos',
  'evidenceIds',
] as const;
const PLAN_LISTS = Object.keys(
  RECOMMENDATION_SCHEMA.properties.plan.properties,
);
/**
 * Supporting lists only: trimmed to the contract's LIST_MAX instead of failing the whole card.
 * `change` (the card's 1–3 bullets), `repos` and `evidenceIds` are never trimmed: an extra
 * bullet or citation is a real error the repair round should fix.
 */
const TRIMMABLE_LISTS = new Set(['alternativesDropped', ...PLAN_LISTS]);
const LIST_MAX = PM_CARD_LIMITS.LIST_MAX;

function asList(value: unknown, trim: boolean): unknown {
  const list =
    typeof value === 'string' && value.trim() ? [value.trim()] : value;
  return trim && Array.isArray(list) && list.length > LIST_MAX
    ? list.slice(0, LIST_MAX)
    : list;
}

/**
 * Lossless or near-lossless repairs of shape slips gpt-5-mini makes on a full recommendation,
 * applied before validation so one slip does not discard an otherwise valid card: fields nested
 * inside `plan` (see hoistMisplacedPlanFields), a list sent as one string, and a supporting list
 * over LIST_MAX. Meaning-bearing limits (title words, description length, enums) are untouched
 * and still go to the repair round.
 */
export function normaliseRecommendation(
  body: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = { ...hoistMisplacedPlanFields(body) };
  for (const key of TOP_LEVEL_LISTS) {
    if (key in out) out[key] = asList(out[key], TRIMMABLE_LISTS.has(key));
  }
  if (out.plan && typeof out.plan === 'object' && !Array.isArray(out.plan)) {
    const plan = { ...out.plan };
    for (const key of PLAN_LISTS) {
      if (key in plan) plan[key] = asList(plan[key], true);
    }
    out.plan = plan;
  }
  return out;
}

const QUESTION_SCHEMA = {
  type: 'object',
  description: 'Required when kind = question.',
  properties: {
    title: { type: 'string', description: 'The question itself.' },
    askedBecause: str,
    usedFor: str,
    options: {
      type: 'array',
      description: '2–4 options; label at most 8 words.',
      items: {
        type: 'object',
        properties: {
          label: str,
          consequence: str,
          suggested: { type: 'boolean' },
        },
        required: ['label', 'consequence'],
      },
    },
    scope: { type: 'string', enum: Object.values(PmQuestionScope) },
    questionKey: {
      type: 'string',
      description:
        'A short stable slug for the question (same question → same key).',
    },
  },
  required: ['title', 'askedBecause', 'usedFor', 'options', 'scope'],
};

/** The forced closing tool of every lane. Its input is the lane's whole output. */
export function submitCandidatesTool(
  maxCandidates: number,
): AgentToolDefinition {
  return {
    name: PM_SUBMIT_TOOL,
    description:
      `End the lane. Call this exactly once, last, with at most ${maxCandidates} candidates ` +
      '(an empty list is a valid answer when nothing meets the bar). Nothing you write outside ' +
      'this call is used.',
    input_schema: {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: Object.values(PmCardKind) },
              category: {
                type: 'string',
                enum: Object.values(PmCardCategory),
              },
              recommendation: RECOMMENDATION_SCHEMA,
              question: QUESTION_SCHEMA,
            },
            required: ['kind', 'category'],
          },
        },
      },
      required: ['candidates'],
    },
  };
}

const slug = (text: string) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

export interface PmCandidateCheck {
  candidate?: PmCandidate;
  errors: string[];
}

/**
 * Lane-level validation of one submitted candidate: the card payload contract
 * (validateCardPayload — lengths, enums, unknown keys rejected) plus the evidence rule (every
 * cited id was returned by a tool in THIS run). Errors are phrased for the model, because the
 * first failure is sent back once as a repair request.
 */
export function checkCandidate(
  raw: unknown,
  lane: PmLane,
  runEvidenceIds: ReadonlySet<string>,
  forced?: { category?: PmCardCategory; revisedFromCardId?: string | null },
): PmCandidateCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['candidate: must be an object'] };
  }
  const input = raw as Record<string, any>;
  const kind = input.kind as PmCardKind;
  if (!Object.values(PmCardKind).includes(kind)) {
    return { errors: ['kind: must be "recommendation" or "question"'] };
  }
  const category = (forced?.category ?? input.category) as PmCardCategory;
  if (!Object.values(PmCardCategory).includes(category)) {
    return { errors: ['category: not a known category'] };
  }
  const body =
    kind === PmCardKind.RECOMMENDATION ? input.recommendation : input.question;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: [`${kind}: the ${kind} object is missing`] };
  }
  const payload: Record<string, any> = {
    ...(kind === PmCardKind.RECOMMENDATION
      ? normaliseRecommendation(body)
      : body),
    schemaVersion: 1,
  };
  if (kind === PmCardKind.QUESTION) {
    payload.questionKey = slug(payload.questionKey || payload.title);
  }
  const errors = validateCardPayload(kind, payload);
  if (
    kind === PmCardKind.RECOMMENDATION &&
    Array.isArray(payload.evidenceIds)
  ) {
    payload.evidenceIds.forEach((id: unknown, index: number) => {
      if (!runEvidenceIds.has(String(id))) {
        errors.push(
          `evidenceIds[${index}]: "${String(id).slice(0, 40)}" was not returned by a tool in this run`,
        );
      }
    });
  }
  if (errors.length) return { errors };
  return {
    errors: [],
    candidate: {
      lane,
      kind,
      category,
      payload,
      questionKey: kind === PmCardKind.QUESTION ? payload.questionKey : null,
      revisedFromCardId: forced?.revisedFromCardId ?? null,
    },
  };
}

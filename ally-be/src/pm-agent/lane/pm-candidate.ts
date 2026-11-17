import { AgentToolDefinition } from 'src/llm-agent/type/agent-llm.type';
import { validateCardPayload } from '../dto/pm-card-payload.dto';
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
  ],
};

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
  const payload: Record<string, any> = { ...body, schemaVersion: 1 };
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

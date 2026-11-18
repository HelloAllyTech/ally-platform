import type { DebriefGraphResponse } from '../service/debrief-graph.client';

/**
 * The ally-be <-> ally-ai wire contract for `POST /debrief/runs` (CONTRACT.md "Versioning").
 * ally-be sends its version and reads what ally-ai answers through `normaliseGraphResponse`:
 * unknown extras pass through, a wrongly shaped optional field is dropped with a warning that
 * names its path, and a response a debrief cannot be built from is a contract error, never a
 * silent partial result.
 */
export const DEBRIEF_CONTRACT_VERSION = 1;

/** A response ally-be cannot read. Its status is 422, so a run ends as failed (and is retried), never "left for the sweeper". */
export class DebriefContractError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(`debrief graph contract: ${message}`);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Statuses after which the learner is shown cards. */
const SHOWN = new Set(['published', 'below_bar']);

export function normaliseGraphResponse(data: unknown): {
  value: DebriefGraphResponse;
  warnings: string[];
} {
  if (!isObject(data))
    throw new DebriefContractError('the response is not an object');
  if (typeof data.status !== 'string' || !data.status) {
    throw new DebriefContractError('the response has no status');
  }
  const warnings: string[] = [];
  const out: Record<string, unknown> = { ...data };

  const v = data.contract_version;
  if (v !== undefined && typeof v !== 'number') {
    warnings.push('contract_version: expected a number');
  } else if (typeof v === 'number' && v > DEBRIEF_CONTRACT_VERSION) {
    warnings.push(
      `contract_version: ally-ai speaks v${v}, ally-be reads v${DEBRIEF_CONTRACT_VERSION}`,
    );
  }

  if (
    data.cards !== undefined &&
    data.cards !== null &&
    !isObject(data.cards)
  ) {
    if (SHOWN.has(data.status)) {
      throw new DebriefContractError(
        `cards: expected an object for a ${data.status} debrief`,
      );
    }
    warnings.push('cards: expected an object or null');
    out.cards = null;
  }

  const list = <T>(
    key: string,
    ok: (item: unknown) => boolean,
    describe: string,
  ): void => {
    const raw = data[key];
    if (raw === undefined) return;
    if (!Array.isArray(raw)) {
      warnings.push(`${key}: expected a list`);
      out[key] = [];
      return;
    }
    const kept = raw.filter((item, i) => {
      const good = ok(item);
      if (!good) warnings.push(`${key}[${i}]: expected ${describe}`);
      return good;
    });
    out[key] = kept as T[];
  };
  list(
    'steps',
    (s) => isObject(s) && typeof s.step === 'string',
    'a step with a name',
  );
  list('logs', isObject, 'an object');
  list(
    'evaluator_hard_fails',
    (h) => isObject(h) && typeof h.code === 'string',
    'a hard fail with a code',
  );
  list(
    'check_failures',
    (c) => typeof c === 'string' || (isObject(c) && typeof c.code === 'string'),
    'a check failure with a code',
  );

  for (const key of [
    'estimated_cost_usd',
    'fallback_rung',
    'revision_rounds',
  ]) {
    const raw = data[key];
    if (raw !== undefined && raw !== null && typeof raw !== 'number') {
      warnings.push(`${key}: expected a number`);
      out[key] = 0;
    }
  }
  for (const key of [
    'has_risk_cue',
    'has_alarm_risk_cue',
    'learner_distress',
    'resumed',
  ]) {
    const raw = data[key];
    if (raw !== undefined && typeof raw !== 'boolean') {
      warnings.push(`${key}: expected true or false`);
      out[key] = !!raw;
    }
  }
  if (data.workspace !== undefined && !isObject(data.workspace)) {
    warnings.push('workspace: expected an object');
    out.workspace = {};
  }

  return { value: out as unknown as DebriefGraphResponse, warnings };
}

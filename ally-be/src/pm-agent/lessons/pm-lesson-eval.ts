import { AgentSystemBlock } from 'src/llm-agent/type/agent-llm.type';
import {
  PmCardCategory,
  PmCardKind,
  PmDecision,
  PmLane,
} from '../enum/pm-agent.enum';
import { PmCritic } from '../gate/pm-critic';
import { PmLlmPort, PmLlmTarget } from '../pipeline/pm-agent-llm.service';
import { PmCandidate, PmEvidenceRef } from '../pipeline/pm-pipeline.types';
import { PmRunLedger } from '../util/run-ledger';
import { PmLessonDecisionRow } from './pm-lesson-data';
import { PM_LESSONS } from './pm-lessons.constants';

/**
 * The eval gate (plan §9b: "blocked unless the eval passes", the rule Builder uses for prompt
 * edits). The real critic is replayed over past decided cards — balanced accepted vs declined —
 * once with the current active lessons (before) and once per candidate with that lesson added
 * (after). Agreement = the share of cards where the critic's pass/fail matches what the admin
 * actually did (accepted → pass; rejected or feedback → fail; a missing verdict is a fail, as
 * the live critic is fail-closed). Every replay goes through the job's ledger, so it reserves
 * before it spends; a replay that cannot reserve returns null and the lesson is not evaluated.
 */

const ACCEPTED = new Set<string>([PmDecision.ACCEPTED, PmDecision.HANDED_OFF]);

export function pickEvalSample(
  rows: PmLessonDecisionRow[],
  max: number = PM_LESSONS.EVAL_MAX_CARDS,
): PmLessonDecisionRow[] {
  const usable = rows.filter(
    (row) =>
      row.kind === PmCardKind.RECOMMENDATION &&
      row.payload &&
      typeof row.payload === 'object' &&
      Object.keys(row.payload).length > 0,
  );
  const pos = usable.filter((row) => ACCEPTED.has(row.decision));
  const neg = usable.filter((row) => !ACCEPTED.has(row.decision));
  const half = Math.floor(max / 2);
  let takePos = Math.min(half, pos.length);
  let takeNeg = Math.min(max - takePos, neg.length);
  takePos = Math.min(max - takeNeg, pos.length);
  takeNeg = Math.min(max - takePos, neg.length);
  return [...pos.slice(0, takePos), ...neg.slice(0, takeNeg)];
}

export interface PmCriticReplayInput {
  llm: PmLlmPort;
  runId: string;
  target: PmLlmTarget;
  promptText: string;
  promptVersion: number | null;
  sharedContext: AgentSystemBlock;
  /** Memory facts + lessons, already fenced. */
  memoryText: string;
  sample: PmLessonDecisionRow[];
  evidence: ReadonlyMap<string, PmEvidenceRef>;
  ledger: PmRunLedger;
}

const toCandidate = (row: PmLessonDecisionRow): PmCandidate => ({
  lane: (row.lane as PmLane) ?? PmLane.ANALYTICS,
  kind: PmCardKind.RECOMMENDATION,
  category: row.category as PmCardCategory,
  payload: row.payload,
});

/** Agreement 0–1 with the admin's real decisions, or null when the critic did not run. */
export async function replayAgreement(
  input: PmCriticReplayInput,
): Promise<number | null> {
  if (!input.sample.length) return null;
  const review = await new PmCritic(input.llm).review({
    runId: input.runId,
    target: input.target,
    promptText: input.promptText,
    promptVersion: input.promptVersion,
    sharedContext: input.sharedContext,
    memoryBlock: input.memoryText,
    candidates: input.sample.map(toCandidate),
    runEvidence: input.evidence,
    ledger: input.ledger,
    // The replayed cards were decided on their merits; most predate roadmap filing and have
    // no `opportunity` to grade. Grading readiness would fail them all and swamp the signal.
    gradeReadiness: false,
  });
  if (review.outcome !== 'ok') return null;
  const pass = new Map(review.verdicts.map((v) => [v.index, v.pass]));
  let agree = 0;
  input.sample.forEach((row, index) => {
    if ((pass.get(index) === true) === ACCEPTED.has(row.decision)) agree += 1;
  });
  return Math.round((agree / input.sample.length) * 1000) / 1000;
}

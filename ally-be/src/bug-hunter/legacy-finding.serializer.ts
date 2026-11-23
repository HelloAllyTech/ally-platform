import { BugFinding } from './entity/bug-finding.entity';
import { BugHuntEvent } from './entity/bug-hunt-event.entity';
import { withBudgetDefaults } from './type/bug-case-budget.type';
import { buildCaseChain } from './type/bug-case-chain.type';
import {
  faultLocationOf,
  independentVerificationOf,
} from './type/bug-finding-verdict.type';
import { readBugFixStudy } from './type/bug-fix-study.type';
import { latestVerdictFor } from './type/bug-fix-verdict.type';
import { wrongFixOf } from './type/bug-wrong-fix.type';
import { effectiveStage } from './util/bug-finding-stage.util';
import { planAttention } from './util/plan-attention.util';

/**
 * The old Bug Hunter's finding and event shapes, kept when its engine was removed
 * (2026-11-23) so its history stays readable: Bug Hunter v2's page (the old page's own
 * components) shows old findings through `BugHunterCompatService`, which serializes
 * `bug_findings` rows with these. Read-only: nothing writes these tables any more.
 */
function readMiss(
  metadata?: Record<string, any> | null,
): Record<string, unknown> | null {
  const miss = metadata?.miss;
  if (!miss || typeof miss !== 'object' || typeof miss.reason !== 'string') {
    return null;
  }
  return {
    reason: miss.reason,
    sense: typeof miss.sense === 'string' ? miss.sense : null,
    matchedFindingId:
      typeof miss.matchedFindingId === 'string' ? miss.matchedFindingId : null,
    confidence: typeof miss.confidence === 'number' ? miss.confidence : null,
    rationale: typeof miss.rationale === 'string' ? miss.rationale : '',
    classifiedAt:
      typeof miss.classifiedAt === 'string' ? miss.classifiedAt : '',
  };
}

function readConfidence(metadata?: Record<string, any> | null): number | null {
  const raw = metadata?.confidence;
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

export function toFindingDto(
  row: BugFinding & Record<string, any> & { steps?: BugFinding[] },
): Record<string, any> {
  return {
    id: row.id,
    runId: row.runId ?? null,
    repo: row.repo ?? null,
    source: row.source,
    title: row.title,
    description: row.description,
    originalDescription: row.originalDescription ?? null,
    descriptionEditedBy: row.descriptionEditedBy ?? null,
    descriptionEditedByName: row.descriptionEditedByName ?? null,
    descriptionEditedAt: row.descriptionEditedAt ?? null,
    file: row.file ?? null,
    symbol: row.symbol ?? null,
    evidence: row.evidence ?? null,
    severity: row.severity ?? null,
    proven: row.proven,
    touchesGuardedPath: row.touchesGuardedPath,
    reportedBugId: row.reportedBugId ?? null,
    status: row.status,
    stage: effectiveStage(row),
    stageIsAuto: row.stageOverride == null,
    stageOverriddenBy: row.stageOverriddenBy ?? null,
    stageOverriddenByName: row.stageOverriddenByName ?? null,
    stageOverriddenAt: row.stageOverriddenAt ?? null,
    report: row.report ?? null,
    prUrl: row.prUrl ?? null,
    escalationQuestion: row.escalationQuestion ?? null,
    escalationAnswer: row.escalationAnswer ?? null,
    escalationAnsweredBy: row.escalationAnsweredBy ?? null,
    escalationAnsweredByName: row.escalationAnsweredByName ?? null,
    escalationAnsweredAt: row.escalationAnsweredAt ?? null,
    decidedBy: row.decidedBy ?? null,
    decidedByName: row.decidedByName ?? null,
    decidedAt: row.decidedAt ?? null,
    decisionReason: row.decisionReason ?? null,
    decisionNote: row.decisionNote ?? null,
    // Lifted out of `metadata` rather than exposing the whole JSONB blob. The
    // column is a scratchpad the pipeline writes freely (fix-attempt counts,
    // vote tallies), and shipping it wholesale would make every key in it an
    // accidental part of the API — see the entity's own note on which keys
    // have readers.
    confidence: readConfidence(row.metadata),
    verificationUnavailable: row.metadata?.verificationUnavailable === true,
    regressionOf:
      typeof row.metadata?.regressionOf === 'string'
        ? row.metadata.regressionOf
        : null,
    regressed: row.metadata?.regressed === true,
    rediscoveredCount: Number(row.metadata?.rediscoveredCount ?? 0) || 0,
    miss: readMiss(row.metadata),
    budget: withBudgetDefaults(row.budget ?? null),
    independentVerification: independentVerificationOf(row.metadata),
    chain: buildCaseChain(row) as unknown as Record<string, unknown>,
    wrongFix: wrongFixOf(row.metadata) as unknown as Record<
      string,
      unknown
    > | null,
    faultLocation: faultLocationOf(row.metadata) as unknown as Record<
      string,
      unknown
    > | null,
    pr: (row.metadata?.pr as Record<string, unknown> | undefined) ?? null,
    latestFixVerdict: latestVerdictFor(
      row.metadata?.fixVerdicts,
      row.prUrl ?? null,
    ) as Record<string, any> | null,
    attention: planAttention(row, row.steps ?? []),
    postmortem:
      row.metadata?.postmortem && typeof row.metadata.postmortem === 'object'
        ? (row.metadata.postmortem as Record<string, unknown>)
        : null,
    study: readBugFixStudy(row.metadata) as unknown as Record<
      string,
      unknown
    > | null,
    sessionRunUrl: row.sessionRunUrl ?? null,
    sessionRunId: row.sessionRunId ?? null,
    engine: row.engine ?? null,
    model: row.model ?? null,
    releaseTag: row.releaseTag ?? null,
    releaseRunUrl: row.releaseRunUrl ?? null,
    releasedBy: row.releasedBy ?? null,
    releasedByName: row.releasedByName ?? null,
    releasedAt: row.releasedAt ?? null,
    cancelledBy: row.cancelledBy ?? null,
    cancelledByName: row.cancelledByName ?? null,
    cancelledAt: row.cancelledAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toEventDto(row: BugHuntEvent): Record<string, unknown> {
  return {
    id: row.id,
    runId: row.runId ?? null,
    repo: row.repo ?? null,
    stage: row.stage,
    summary: row.summary,
    payload: row.payload ?? null,
    suggestionId: row.suggestionId ?? null,
    findingId: row.findingId ?? null,
    createdAt: row.createdAt,
  };
}

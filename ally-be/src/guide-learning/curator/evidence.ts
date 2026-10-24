import { AgentLessonScope } from 'src/llm-agent/harness/enum/learning.enum';
import { GuideLoopPolicy } from 'src/guide/release/guide-release.bundle';

/**
 * Evidence for the curator (plans/ally-guide/plan.md §7.13): failures the
 * loop has reason to trust — critic verdicts on κ-trusted criteria, people's
 * review labels, deterministic check failures — grouped by what failed and
 * where. Pure. Holds counts, ids and judge-written reasons; never a
 * learner's words.
 */

/** One failed signal on one turn, as read from the evaluator and the review queue. */
export interface EvidenceRow {
  /** `criterion:<id>` (critic or person) or `check:<id>` (deterministic). */
  signal: string;
  source: 'critic' | 'review' | 'check';
  turnId: string;
  evaluationId: string | null;
  /** Pseudonymous learner key: `u:<userId>` or `v:<visitorId>`. */
  learner: string | null;
  tenantId: string | null;
  trackId: string | null;
  /** A judge's or reviewer's reason, already redacted. Never learner text. */
  reason: string | null;
}

export interface EvidenceCluster {
  /** Stable within a run: `<scope>:<signal>:<n>`. What the model cites. */
  id: string;
  signal: string;
  scope: AgentLessonScope;
  tenantId: string | null;
  trackId: string | null;
  turns: number;
  learners: number;
  tenants: number;
  sources: Record<string, number>;
  evaluationIds: string[];
  reasons: string[];
}

const MAX_REASONS = 5;
const MAX_IDS = 20;

/**
 * Group rows three ways: every row counts platform-wide, for its
 * organisation and for its course. A cluster's scope is fixed here, so the
 * model can never widen a lesson past the evidence it cites.
 */
export function buildClusters(rows: EvidenceRow[]): EvidenceCluster[] {
  type Acc = {
    signal: string;
    scope: AgentLessonScope;
    tenantId: string | null;
    trackId: string | null;
    turns: Set<string>;
    learners: Set<string>;
    tenants: Set<string>;
    sources: Record<string, number>;
    evaluationIds: Set<string>;
    reasons: string[];
  };
  const groups = new Map<string, Acc>();
  const add = (
    key: string,
    scope: AgentLessonScope,
    row: EvidenceRow,
    target: { tenantId: string | null; trackId: string | null },
  ) => {
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        signal: row.signal,
        scope,
        ...target,
        turns: new Set(),
        learners: new Set(),
        tenants: new Set(),
        sources: {},
        evaluationIds: new Set(),
        reasons: [],
      };
      groups.set(key, acc);
    }
    acc.turns.add(row.turnId);
    if (row.learner) acc.learners.add(row.learner);
    if (row.tenantId) acc.tenants.add(row.tenantId);
    acc.sources[row.source] = (acc.sources[row.source] ?? 0) + 1;
    if (row.evaluationId && acc.evaluationIds.size < MAX_IDS) {
      acc.evaluationIds.add(row.evaluationId);
    }
    const reason = row.reason?.trim();
    if (
      reason &&
      acc.reasons.length < MAX_REASONS &&
      !acc.reasons.includes(reason)
    ) {
      acc.reasons.push(reason.slice(0, 240));
    }
  };
  for (const row of rows) {
    add(`platform|${row.signal}`, AgentLessonScope.PLATFORM, row, {
      tenantId: null,
      trackId: null,
    });
    if (row.tenantId) {
      add(`org|${row.signal}|${row.tenantId}`, AgentLessonScope.ORG, row, {
        tenantId: row.tenantId,
        trackId: null,
      });
    }
    if (row.trackId) {
      add(`course|${row.signal}|${row.trackId}`, AgentLessonScope.COURSE, row, {
        tenantId: null,
        trackId: row.trackId,
      });
    }
  }
  const out = [...groups.values()]
    .map((acc) => ({
      signal: acc.signal,
      scope: acc.scope,
      tenantId: acc.tenantId,
      trackId: acc.trackId,
      turns: acc.turns.size,
      learners: acc.learners.size,
      tenants: acc.tenants.size,
      sources: acc.sources,
      evaluationIds: [...acc.evaluationIds],
      reasons: acc.reasons,
    }))
    .sort(
      (a, b) =>
        b.learners - a.learners ||
        b.turns - a.turns ||
        a.signal.localeCompare(b.signal),
    );
  const counters = new Map<string, number>();
  return out.map((cluster) => {
    const prefix = `${cluster.scope}:${cluster.signal}`;
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return { id: `${prefix}:${n}`, ...cluster };
  });
}

export interface EvidenceVerdict {
  ok: boolean;
  /** Plain words for the audit and the Console. */
  why: string;
}

/**
 * Appendix A "Evidence required": a platform lesson needs ≥ 2 learners
 * across ≥ 2 organisations — one organisation's habit is not a platform
 * truth; an organisation or course lesson needs ≥ 5 learners, so it is
 * never about one person.
 */
export function evidenceSuffices(
  cluster: Pick<EvidenceCluster, 'scope' | 'learners' | 'tenants'>,
  policy: Pick<
    GuideLoopPolicy,
    | 'evidencePlatformLearners'
    | 'evidencePlatformTenants'
    | 'evidenceScopedLearners'
  >,
): EvidenceVerdict {
  if (cluster.scope === AgentLessonScope.PLATFORM) {
    const ok =
      cluster.learners >= policy.evidencePlatformLearners &&
      cluster.tenants >= policy.evidencePlatformTenants;
    return {
      ok,
      why: ok
        ? `${cluster.learners} learners across ${cluster.tenants} organisations`
        : `a platform lesson needs ${policy.evidencePlatformLearners}+ learners across ${policy.evidencePlatformTenants}+ organisations; this has ${cluster.learners} across ${cluster.tenants}`,
    };
  }
  const ok = cluster.learners >= policy.evidenceScopedLearners;
  return {
    ok,
    why: ok
      ? `${cluster.learners} learners`
      : `an ${cluster.scope === AgentLessonScope.ORG ? 'organisation' : 'course'} lesson needs ${policy.evidenceScopedLearners}+ learners; this has ${cluster.learners}`,
  };
}

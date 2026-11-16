/** Bug Hunter v2 reports and verdicts (ally-be `bug-hunter-approvals`). */
export type BugHunterV2Diagnosis = "correct" | "wrong" | "not_a_bug";
export type BugHunterV2FixVerdict = "worked" | "needed_edits" | "wrong" | "none";
export type BugHunterV2ReportFilter = "open" | "judged" | "all";

export interface BugHunterV2ReportItem {
  id: number;
  createdAt: string;
  app: string;
  source: string;
  status: "suggested_fix" | "escalated" | string;
  title: string;
  severity: string | null;
  confidence: string | null;
  riskLevel: string | null;
  verdict: {
    diagnosis: BugHunterV2Diagnosis;
    fix: BugHunterV2FixVerdict;
    decidedAt: string;
  } | null;
}

export interface BugHunterV2Verdict {
  id: number;
  diagnosis: BugHunterV2Diagnosis;
  fix: BugHunterV2FixVerdict;
  reason: string;
  decidedBy: string;
  source: string;
  decidedAt: string;
  active: boolean;
  supersededAt: string | null;
}

export interface BugHunterV2ReportDetail extends Omit<BugHunterV2ReportItem, "verdict"> {
  runId: string | null;
  stopReason: string | null;
  rootCause: string | null;
  finding: {
    title?: string;
    category?: string;
    severity?: string;
    hypothesis?: string;
    evidence?: string[];
    suspected_files?: string[];
    files?: string[];
  } | null;
  repro: {
    test_path?: string;
    test_name?: string;
    source?: string | null;
    failure_excerpt?: string;
  } | null;
  patchDiff: string | null;
  review: {
    verdict?: string;
    notes?: string[];
    counterexamples?: { name: string; claim: string; status: string; dispute_reason?: string }[];
    disputed?: boolean;
  } | null;
  verdicts: BugHunterV2Verdict[];
}

export interface BugHunterV2VerdictInput {
  id: number;
  diagnosis: BugHunterV2Diagnosis;
  fix: BugHunterV2FixVerdict;
  reason: string;
}

/** Chunk 10: the modes and the board (ally-be `bug-hunter-approvals` settings + bugs). */
export type BugHunterV2Mode = "off" | "manual" | "autonomous";
export type BugHunterV2Tab = "needs_you" | "failed" | "in_progress" | "backlog" | "done";
export type BugHunterV2BugStatus =
  | "backlog"
  | "queued"
  | "running"
  | "needs_you"
  | "failed"
  | "done";

export interface BugHunterV2Settings {
  mode: BugHunterV2Mode;
  dailyRunLimit: number;
  startedToday: number;
  updatedBy: number | null;
  updatedAt: string | null;
}

export interface BugHunterV2Bug {
  /** `v2`: Bug Hunter v2's queue. `v1`: the old Bug Hunter's finding, read live. */
  origin: "v2" | "v1";
  /** The v2 queue id; null for a v1 row. */
  id: number | null;
  /** The old Bug Hunter's finding id; null for a v2 row. */
  v1FindingId: string | null;
  /** v2's source, or `v1:<finding source>` for a v1 row. */
  source: string;
  app: string | null;
  title: string;
  description: string;
  /** v2's queue status, or the v1 finding's own status for a v1 row. */
  status: BugHunterV2BugStatus | string;
  tab: BugHunterV2Tab;
  reason: string | null;
  severity: string | null;
  prUrl: string | null;
  reportId: number | null;
  runId: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface BugHunterV2Board {
  tab: BugHunterV2Tab;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<BugHunterV2Tab, number>;
  items: BugHunterV2Bug[];
}

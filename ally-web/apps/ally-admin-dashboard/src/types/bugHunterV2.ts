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

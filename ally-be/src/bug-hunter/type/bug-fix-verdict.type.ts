/**
 * The Verifier's judgement on a fix — OPP-0779.
 *
 * A fix session used to verify its own work and, where policy allowed, merge
 * it. On 2026-10-02 a fix that wrote 385 blank translations per language
 * passed its own checks and merged itself; nobody independent had read it.
 * From now on a fix stops at "PR opened". A separate run, on a different
 * vendor's model, checks out the PR and works through this checklist. Bug
 * Hunter merges only on a pass, and only where policy already allowed a
 * self-merge.
 *
 * The verdict word is not trusted: `pass` is COMPUTED from the checks here.
 * A verifier that says "pass" with a failed required check has contradicted
 * itself, and the checks win.
 */
export const BUG_FIX_VERDICT_CHECKS = [
  /** The PR's regression test, run against the base commit, fails. */
  'repro_at_base_fails',
  /** The same test, run against the PR head, passes. */
  'repro_at_head_passes',
  /** The repo's own test, lint and type commands at head; pre-existing failures compared against base, not excused by hand. */
  'suite',
  /** Every hunk is required by the brief, or named as scope creep. Data, locale and generated files are counted, not skimmed. */
  'diff_vs_brief',
  /** For data, locale, seed or generated files: counts before and after (keys, rows, blank values). */
  'data_file_counts',
  /** Callers of every changed exported symbol were read; behaviour at the boundaries the finding names. */
  'blast_radius',
  /** Frontend: the affected route loaded and looked at. Often skipped in CI, and says so. */
  'what_user_sees',
  /** The diff against the fixer's study: same files, the mechanism the codebase already uses, a sender for anything read from a request. Skipped only when no study exists. */
  'study_followed',
  /** The diff changes the layer the Verifier located the fault in; a PR for a data or config fault fails here. Skipped when no fault was located. */
  'fault_layer_matches',
  /** The reporter's own steps (or the finding Verifier's reproduction) re-run at the PR head: the symptom is gone, not only the PR's test green. Required whenever steps exist. */
  'symptom_resolved',
  /** Every reader of a value the diff changes — in this repo and in /tmp/siblings — still works, or is covered by a cross-repo plan. Skipped only when the diff changes no value anything else reads. */
  'consumers_updated',
  /** Server-computed (OPP-0759): the PR touches a file a person must merge — Bug Hunter's own files, migrations, locales, seeds, snapshots, lockfiles, a stray pr-body.md. */
  'forbidden_files',
] as const;
export type BugFixVerdictCheckName = (typeof BUG_FIX_VERDICT_CHECKS)[number];

export interface BugFixVerdictCheck {
  name: BugFixVerdictCheckName;
  /** True when the check passed. False when it failed. Null when skipped, with `skipped` saying why. */
  ok: boolean | null;
  /** The command, count, screenshot path or assertion that backs the result. Never "looks fine". */
  evidence: string | null;
  skipped: string | null;
}

export interface BugFixVerdict {
  verdict: 'pass' | 'fail';
  /** 0–1: how sure the verifier is of its own verdict. */
  confidence: number | null;
  checks: BugFixVerdictCheck[];
  /** True when the diff does more than the brief asked. A pass is impossible with this set. */
  scopeExceeded: boolean;
  /** The sentence that would have to be false for this verdict to be wrong. */
  wouldBeWrongIf: string | null;
  /** One or two sentences a reviewer reads first. */
  summary: string | null;
  /** Which engine and model judged, as the run reported them. */
  by: { engine: string | null; model: string | null };
  prUrl: string | null;
  /** The PR head this verdict is about; a later push invalidates it. */
  prHeadSha: string | null;
  runId: string | null;
  at: string;
}

/** The latest verdict for a PR head, or for the PR when no head is known. */
export function latestVerdictFor(
  verdicts: BugFixVerdict[] | null | undefined,
  prUrl: string | null,
  prHeadSha?: string | null,
): BugFixVerdict | null {
  if (!Array.isArray(verdicts) || !verdicts.length) return null;
  const matching = verdicts.filter(
    (v) =>
      (!prUrl || !v.prUrl || v.prUrl === prUrl) &&
      (!prHeadSha || !v.prHeadSha || v.prHeadSha === prHeadSha),
  );
  if (!matching.length) return null;
  return matching.sort((a, b) => b.at.localeCompare(a.at))[0];
}

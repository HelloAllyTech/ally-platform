/**
 * An independent verifier's judgement on a FINDING — OPP-0780.
 *
 * The sweep's own Verify phase runs two sub-agents on the same engine, inside
 * the same run, with the same context that produced the finding. That is a
 * useful first filter and a poor gate: it shares the finder's blind spots,
 * and on Gemini it does not run at all. So once a sweep closes, Bug Hunter
 * opens one more run on the OTHER vendor, hands it every unproven finding
 * the sweep kept, and asks it to reproduce each and then try to refute it.
 *
 * Until that run has spoken, an unproven finding is `pending`: it is listed,
 * but Bug Hunter does not fix it in AI mode. `confirmed` findings in AI mode
 * get a fix session started by the server; `refuted` ones are dismissed with
 * the verifier's reason; `unsure` ones are held for a person.
 */
export const BUG_FINDING_VERDICTS = ['confirmed', 'refuted', 'unsure'] as const;
export type BugFindingVerdictWord = (typeof BUG_FINDING_VERDICTS)[number];

export type IndependentVerification = 'pending' | BugFindingVerdictWord;

/**
 * Where the fault is, as the Verifier located it — the answer a fix session
 * must start from, and the reason "locate before fixing" exists.
 *
 * On 2026-10-12 two human reports about untranslated screens were "fixed"
 * in the frontend while the cause was missing rows in production data: the
 * Fixer saw one repo's source and no running system, and nobody had said
 * which layer was broken before it was asked to fix it. The Verifier now
 * reads a human report first, probes production, and commits to a layer.
 * `data` and `config` never go to a fix session; they go to a person with
 * the exact repair. This is link three of the case chain (see
 * bug-case-chain.type.ts): without it a fix is a guess at the symptom.
 */
export const BUG_FAULT_LAYERS = ['code', 'data', 'config', 'unknown'] as const;
export type BugFaultLayer = (typeof BUG_FAULT_LAYERS)[number];

export interface BugFaultLocation {
  layer: BugFaultLayer;
  /** The repo that owns the broken layer, which may not be the one the report was filed against. */
  repo: string | null;
  /** What was observed in production or against live data: the request and what it returned. */
  evidence: string | null;
  /** For data and config faults: the exact repair a person should make, in one or two sentences. */
  repair: string | null;
}

/** The latest located fault on a finding, from its stored verdicts, or null. */
export function faultLocationOf(
  metadata: Record<string, any> | null | undefined,
): BugFaultLocation | null {
  const verdicts = metadata?.findingVerdicts;
  if (!Array.isArray(verdicts)) return null;
  for (let i = verdicts.length - 1; i >= 0; i -= 1) {
    const fault = verdicts[i]?.fault;
    if (fault && BUG_FAULT_LAYERS.includes(fault.layer)) {
      return {
        layer: fault.layer,
        repo: typeof fault.repo === 'string' ? fault.repo : null,
        evidence: typeof fault.evidence === 'string' ? fault.evidence : null,
        repair: typeof fault.repair === 'string' ? fault.repair : null,
      };
    }
  }
  return null;
}

/** A fault a fix session cannot fix: the repair is a row or a setting, not a diff. */
export const isDataFault = (fault: BugFaultLocation | null): boolean =>
  fault?.layer === 'data' || fault?.layer === 'config';

/** Where a finding stands with the independent verifier, from its metadata. */
export function independentVerificationOf(
  metadata: Record<string, any> | null | undefined,
): IndependentVerification | null {
  const v = metadata?.independentVerification;
  return v === 'pending' || BUG_FINDING_VERDICTS.includes(v as never)
    ? (v as IndependentVerification)
    : null;
}

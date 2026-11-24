/**
 * Core of the assistants cutover dry-run orchestrator (stage 10). Pure: it takes the steps to run,
 * so a test can prove it applies nothing. The CLI that wires the real services is
 * assistants-cutover-dry-run.ts.
 */
export interface DryRunStep {
  name: string;
  /** Must perform the step's dry run. */
  run: () => Promise<unknown>;
}

export interface DryRunStepResult {
  name: string;
  ok: boolean;
  /** The step answered with `dryRun: false`: it applied something. The run is a failure. */
  appliedSomething: boolean;
  report?: unknown;
  error?: string;
}

export interface DryRunCombinedReport {
  generatedAt: string;
  steps: DryRunStepResult[];
  failed: string[];
  appliedSomething: string[];
}

const claimsApplied = (report: unknown): boolean =>
  typeof report === 'object' &&
  report !== null &&
  (report as { dryRun?: unknown }).dryRun === false;

export async function runCutoverDryRun(
  steps: DryRunStep[],
  now = new Date(),
): Promise<DryRunCombinedReport> {
  const results: DryRunStepResult[] = [];
  for (const step of steps) {
    try {
      const report = await step.run();
      const applied = claimsApplied(report);
      results.push({
        name: step.name,
        ok: !applied,
        appliedSomething: applied,
        report,
      });
    } catch (error) {
      results.push({
        name: step.name,
        ok: false,
        appliedSomething: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    generatedAt: now.toISOString(),
    steps: results,
    failed: results.filter((r) => !r.ok).map((r) => r.name),
    appliedSomething: results
      .filter((r) => r.appliedSomething)
      .map((r) => r.name),
  };
}

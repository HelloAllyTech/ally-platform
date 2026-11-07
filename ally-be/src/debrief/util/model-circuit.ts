/**
 * A per-model circuit breaker for the Debrief agent's steps (v9: "provider
 * outage → circuit breaker; runs errored; fallbacks per FR-19").
 *
 * When one model has failed FAILURES_TO_OPEN times within WINDOW_MS, with no
 * success since, the breaker opens for OPEN_MS: steps go straight to their
 * backup model instead of spending a learner's deadline waiting on a
 * provider that is down. Per process, in memory — each ally-be task learns
 * an outage for itself within a few calls, which is all it needs.
 */
export const FAILURES_TO_OPEN = 5;
export const WINDOW_MS = 2 * 60 * 1000;
export const OPEN_MS = 5 * 60 * 1000;

const failures = new Map<string, number[]>();
const openUntil = new Map<string, number>();

export function recordModelFailure(model: string, at = Date.now()): void {
  const recent = (failures.get(model) ?? []).filter((t) => at - t < WINDOW_MS);
  recent.push(at);
  failures.set(model, recent);
  if (recent.length >= FAILURES_TO_OPEN) openUntil.set(model, at + OPEN_MS);
}

export function recordModelSuccess(model: string): void {
  failures.delete(model);
  openUntil.delete(model);
}

export function isModelCircuitOpen(model: string, at = Date.now()): boolean {
  const until = openUntil.get(model);
  if (until === undefined) return false;
  if (at >= until) {
    // Half-open: the next call tries the model again.
    openUntil.delete(model);
    failures.delete(model);
    return false;
  }
  return true;
}

/**
 * The order to try a step's models in: its model, then its backup — with
 * the backup first while the model's breaker is open.
 */
export function modelsToTry(
  model: string | null | undefined,
  backup: string | null | undefined,
  at = Date.now(),
): Array<string | null | undefined> {
  const second = backup ?? model;
  if (model && backup && backup !== model && isModelCircuitOpen(model, at)) {
    return [backup, model];
  }
  return [model, second];
}

/** For tests. */
export function resetModelCircuits(): void {
  failures.clear();
  openUntil.clear();
}

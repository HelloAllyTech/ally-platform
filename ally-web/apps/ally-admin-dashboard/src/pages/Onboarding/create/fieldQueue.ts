import type { FieldEditResult } from "@api";

import { codeOf, errorOf, isCreditsRequired, messageOf, sameValue } from "./logic";

/** How a field's latest edit stands. */
export type FieldStatus = "idle" | "saving" | "saved" | "stale" | "refused" | "credits" | "failed";

export interface FieldOutcome {
  status: FieldStatus;
  /** The server's reason, for a refused edit. */
  reason?: string | null;
  /** On 409 `stale_field`: what the field says now on the server, for Reload. */
  current?: { value: unknown; version: string };
}

export interface FieldQueueHooks {
  send: (field: string, value: unknown, version: string) => Promise<FieldEditResult>;
  /** The edit was saved: `latest` is false when a newer edit for the field is already queued. */
  onSaved: (field: string, result: FieldEditResult, latest: boolean, sent: unknown) => void;
  /** Anything else: the typed text is kept by the caller, never replaced. */
  onOutcome: (field: string, outcome: FieldOutcome) => void;
}

interface Chain {
  version: string;
  running: boolean;
  queued: boolean;
  latest: unknown;
  done: Promise<void> | null;
}

/**
 * One queue per field (plan section 3, "Conflicts and ordering"). Edits to a field are sent one at
 * a time, each with the version the previous one returned, so rapid edits never conflict with each
 * other; only the newest typed value is sent after an in-flight one. A conflict (409
 * `stale_field`) or a refusal stops that field's queue and reports it; the caller keeps the typed
 * text marked "not applied" and offers Reload (take theirs) or Overwrite (keep mine). Different
 * fields never wait for each other.
 */
export class FieldQueue {
  private readonly chains = new Map<string, Chain>();

  constructor(private readonly hooks: FieldQueueHooks) {}

  private chain(field: string): Chain {
    let c = this.chains.get(field);
    if (!c) {
      c = { version: "", running: false, queued: false, latest: undefined, done: null };
      this.chains.set(field, c);
    }
    return c;
  }

  /** The server's version for a field, from a fresh read. Ignored while the field is busy. */
  setBase(field: string, version: string): void {
    const c = this.chain(field);
    if (!c.running) c.version = version;
  }

  /** Force the base version (Overwrite: edit on top of what the server says now). */
  rebase(field: string, version: string): void {
    this.chain(field).version = version;
  }

  version(field: string): string {
    return this.chain(field).version;
  }

  /** True while an edit to the field is being sent or waits to be. */
  busy(field: string): boolean {
    const c = this.chains.get(field);
    return Boolean(c && (c.running || c.queued));
  }

  /** Queue the field's newest value. Resolves when the queue for this field is idle again. */
  submit(field: string, value: unknown): Promise<void> {
    const c = this.chain(field);
    c.latest = value;
    c.queued = true;
    if (c.running && c.done) return c.done;
    c.done = this.run(field, c);
    return c.done;
  }

  private async run(field: string, c: Chain): Promise<void> {
    c.running = true;
    try {
      while (c.queued) {
        c.queued = false;
        const value = c.latest;
        this.hooks.onOutcome(field, { status: "saving" });
        try {
          const result = await this.hooks.send(field, value, c.version);
          c.version = result.version;
          const latest = !c.queued && sameValue(value, c.latest);
          this.hooks.onSaved(field, result, latest, value);
          if (latest) this.hooks.onOutcome(field, { status: "saved" });
        } catch (error) {
          c.queued = false;
          this.hooks.onOutcome(field, outcomeOf(error));
          return;
        }
      }
    } finally {
      c.running = false;
      c.done = null;
    }
  }
}

/** A failed edit as the field shows it. */
export const outcomeOf = (error: unknown): FieldOutcome => {
  if (isCreditsRequired(error)) return { status: "credits" };
  const code = codeOf(error);
  const details = errorOf(error).data?.details;
  if (code === "stale_field" || (errorOf(error).status === 409 && details?.version)) {
    return {
      status: "stale",
      current: details?.version
        ? { value: details.value ?? null, version: String(details.version) }
        : undefined,
    };
  }
  const status = errorOf(error).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return { status: "refused", reason: messageOf(error) };
  }
  return { status: "failed" };
};

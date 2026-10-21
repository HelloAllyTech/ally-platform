import type { BuilderTurnReceipt } from "@types";

import { asAgentText, asAgentTextList } from "./agentAuthored";

const LIST_KEYS = ["read", "searched", "changed", "failed", "warnings"] as const;

const asVersion = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * A turn receipt off the wire or out of a persisted row, made safe to render — or `null` when it
 * is not one.
 *
 * The server composes every string, but the receipt is still JSON read back out of a
 * `metadata` column and a stream frame, and agent-authored JSON has crashed Builder's panels
 * before (see `agentAuthored.ts`). So: anything that is not an object, or that carries none of the
 * five lists, is not a receipt and is dropped rather than half-drawn; each list is read through
 * `asAgentTextList`, which keeps a lone string as one line (a failure must not vanish because it
 * was filed as a string); and a missing or non-numeric `prdVersion` reads as "unchanged".
 *
 * Idempotent, so the hook, the component and the PDF export can each call it on whatever they were
 * handed without caring whether an earlier layer already did.
 */
export const normalizeTurnReceipt = (value: unknown): BuilderTurnReceipt | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!LIST_KEYS.some(key => Array.isArray(record[key]))) return null;

  const version = record.prdVersion as { from?: unknown; to?: unknown } | null | undefined;
  const from = asVersion(version?.from);
  const to = asVersion(version?.to);
  const because = asAgentText(record.prdUnchangedBecause).trim();

  return {
    read: asAgentTextList(record.read),
    searched: asAgentTextList(record.searched),
    changed: asAgentTextList(record.changed),
    failed: asAgentTextList(record.failed),
    warnings: asAgentTextList(record.warnings),
    prdVersion: from !== null && to !== null ? { from, to } : { from: 0, to: 0 },
    ...(because ? { prdUnchangedBecause: because } : {}),
  };
};

import type { AgentTurnReceipt } from "@types";

import { asAgentText, asAgentTextList } from "./agentAuthored";

const LIST_KEYS = ["read", "searched", "changed", "failed", "warnings"] as const;

/**
 * A turn receipt off the wire or out of a persisted row, made safe to render — or `null` when it is
 * not one. The same rules as Builder's `normalizeTurnReceipt`: anything that is not an object, or
 * carries none of the five lists, is dropped rather than half-drawn, and each list is read through
 * `asAgentTextList`, which keeps a lone string as one line.
 *
 * Idempotent, so the hook and the component can each call it on whatever they were handed.
 */
export const normalizeAgentReceipt = (value: unknown): AgentTurnReceipt | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!LIST_KEYS.some(key => Array.isArray(record[key]))) return null;
  const because = asAgentText(record.unchangedBecause).trim();
  return {
    read: asAgentTextList(record.read),
    searched: asAgentTextList(record.searched),
    changed: asAgentTextList(record.changed),
    failed: asAgentTextList(record.failed),
    warnings: asAgentTextList(record.warnings),
    ...(because ? { unchangedBecause: because } : {}),
  };
};

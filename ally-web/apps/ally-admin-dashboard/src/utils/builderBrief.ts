import type { BuilderBriefLine, BuilderBriefResponse, BuilderSituationBrief } from "@types";

import { asAgentText } from "./agentAuthored";

const KINDS = new Set(["exists", "alreadyMet", "proposal", "repo"]);
const APPROACHES = new Set(["reuse", "extend", "new"]);

const asRecords = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object",
      )
    : [];

/**
 * A situation brief off the wire or out of a row, made safe to render — or `null` when it is
 * not one. The server composes it, but it is still JSON read back out of a `metadata` column,
 * and agent-adjacent JSON has crashed Builder's panels before: a line with no id or text is
 * dropped rather than half-drawn, and a citation list that is not one reads as none.
 */
export const normalizeSituationBrief = (value: unknown): BuilderSituationBrief | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = asAgentText(record.id).trim();
  if (!id || !Array.isArray(record.lines)) return null;
  const lines: BuilderBriefLine[] = asRecords(record.lines)
    .map(line => {
      const kind = asAgentText(line.kind);
      const approach = asAgentText(line.approach);
      return {
        id: asAgentText(line.id).trim(),
        kind: (KINDS.has(kind) ? kind : "exists") as BuilderBriefLine["kind"],
        text: asAgentText(line.text).trim(),
        cites: asRecords(line.cites)
          .map(cite => ({ ref: asAgentText(cite.ref), label: asAgentText(cite.label) }))
          .filter(cite => cite.label),
        ...(asAgentText(line.part) ? { part: asAgentText(line.part) } : {}),
        ...(APPROACHES.has(approach) ? { approach: approach as BuilderBriefLine["approach"] } : {}),
        ...(asAgentText(line.repo) ? { repo: asAgentText(line.repo) } : {}),
      };
    })
    .filter(line => line.id && line.text);
  return { id, message: asAgentText(record.message), lines };
};

/** The admin's stored answer to a brief, or `null`. */
export const normalizeBriefResponse = (value: unknown): BuilderBriefResponse | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const briefId = asAgentText(record.briefId).trim();
  if (!briefId) return null;
  const note = asAgentText(record.note).trim();
  return {
    briefId,
    lines: asRecords(record.lines)
      .map(line => {
        const correction = asAgentText(line.correction).trim();
        return line.verdict === "correct" && correction
          ? { id: asAgentText(line.id), verdict: "correct" as const, correction }
          : { id: asAgentText(line.id), verdict: "confirm" as const };
      })
      .filter(line => line.id),
    ...(note ? { note } : {}),
  };
};

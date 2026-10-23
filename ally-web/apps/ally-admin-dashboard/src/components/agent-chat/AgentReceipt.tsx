import React from "react";

import { en } from "@constants";

import { normalizeAgentReceipt } from "../../utils/agentReceipt";

export type AgentReceiptStrings = typeof en.agentChat.receipt;

interface AgentReceiptProps {
  /** Anything off the wire or a row; drawn only if it reads as a receipt. */
  receipt: unknown;
  /** The agent's own wording where it differs from `en.agentChat.receipt`. */
  strings?: Partial<AgentReceiptStrings>;
  /** One more group at the end of the summary — Builder's "PRD v7 → v9". */
  extraSummary?: string | null;
}

const List: React.FC<{ heading: string; items: string[]; mono?: boolean }> = ({
  heading,
  items,
  mono,
}) => (
  <div>
    <p className="font-medium text-typography-600">{heading}</p>
    <ul className={`list-disc pl-4 ${mono ? "break-all font-mono" : "break-words"}`}>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  </div>
);

/**
 * What one agent turn did, drawn under its reply: what it read, searched, changed and what failed.
 * Shared by Builder, Course Copilot and the character interview.
 *
 * The receipt is built by the server from what actually happened, so it is the record — the
 * agent's own account of its turn is the reply above it, and the two are meant to be checked
 * against each other. That sets what is folded away and what is not:
 *
 * - The summary is one muted line and the long lists sit behind "Details" (a native `<details>`:
 *   keyboard-accessible, no state to keep). Reading and searching are what a person will rarely
 *   audit.
 * - Failures, warnings and the reason nothing changed are never behind the toggle. A lookup that
 *   failed or a change that never landed is exactly the thing a fluent reply papers over, so it
 *   has to be on screen without a click — and in words as well as colour.
 *
 * Anything that is not a readable receipt renders nothing.
 */
export const AgentReceipt: React.FC<AgentReceiptProps> = ({
  receipt: raw,
  strings: overrides,
  extraSummary,
}) => {
  const receipt = normalizeAgentReceipt(raw);
  if (!receipt) return null;

  const strings: AgentReceiptStrings = { ...en.agentChat.receipt, ...overrides };
  const { read, searched, changed, failed, warnings, unchangedBecause } = receipt;

  // "Read 3 · Searched 4 · 2 changes" — only the groups that are non-zero.
  const parts = [
    read.length ? strings.read(read.length) : "",
    searched.length ? strings.searched(searched.length) : "",
    changed.length ? strings.changed(changed.length) : "",
    extraSummary ?? "",
  ].filter(Boolean);
  // Nothing read, searched or changed. "No lookups" would be a lie if a lookup was attempted and
  // failed, and the failure lines already say what happened — so then there is no summary at all.
  // A stated reason for nothing changing is shown on its own line; it is not said twice.
  const summary = parts.length
    ? parts.join(" · ")
    : failed.length
      ? ""
      : unchangedBecause
        ? strings.noLookups
        : strings.noActivity;
  const hasDetails = read.length > 0 || searched.length > 0 || changed.length > 0;

  if (!summary && !failed.length && !warnings.length && !unchangedBecause) return null;

  return (
    <div
      role="group"
      aria-label={strings.label}
      className="flex w-full max-w-[92%] flex-col gap-1 px-1 text-xs text-typography-500"
    >
      {hasDetails ? (
        <details>
          <summary className="cursor-pointer select-none hover:text-typography-700">
            {summary}
          </summary>
          <div className="mt-2 flex flex-col gap-2 border-l border-border-light pl-3">
            {read.length > 0 && <List heading={strings.readHeading} items={read} mono />}
            {searched.length > 0 && <List heading={strings.searchedHeading} items={searched} />}
            {changed.length > 0 && <List heading={strings.changedHeading} items={changed} />}
          </div>
        </details>
      ) : (
        summary && <p>{summary}</p>
      )}

      {failed.length > 0 && (
        <div className="text-destructive-600">
          <p className="font-medium">{strings.failedHeading}</p>
          <ul className="list-disc break-words pl-4">
            {failed.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="text-warning-text">
          <p className="font-medium">{strings.warningsHeading}</p>
          <ul className="list-disc break-words pl-4">
            {warnings.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {unchangedBecause && <p className="break-words">{strings.unchanged(unchangedBecause)}</p>}
    </div>
  );
};

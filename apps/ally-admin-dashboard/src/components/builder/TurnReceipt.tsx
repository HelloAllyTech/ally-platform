import React from "react";

import { en } from "@constants";
import type { BuilderTurnReceipt } from "@types";

import { normalizeTurnReceipt } from "../../utils/builderReceipt";

interface TurnReceiptProps {
  receipt: BuilderTurnReceipt | null | undefined;
}

/** "Read 3 · Searched 4 · Changed 2 sections · PRD v7 → v9" — only the groups that are non-zero. */
const summaryOf = (receipt: BuilderTurnReceipt): string => {
  const strings = en.builder.chat.receipt;
  const { read, searched, changed, failed, prdVersion, prdUnchangedBecause } = receipt;

  const parts = [
    read.length ? strings.read(read.length) : "",
    searched.length ? strings.searched(searched.length) : "",
    changed.length ? strings.changed(changed.length) : "",
    prdVersion.from !== prdVersion.to ? strings.prdVersion(prdVersion.from, prdVersion.to) : "",
  ].filter(Boolean);
  if (parts.length) return parts.join(" · ");

  // Nothing read, searched or changed. "No lookups" would be a lie if a lookup was attempted and
  // failed, and the failure lines already say what happened — so then there is no summary at all.
  if (failed.length) return "";
  // A stated reason for the PRD standing still is shown on its own line; don't say it twice.
  return prdUnchangedBecause ? strings.noLookups : strings.noActivity;
};

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
 * What one Builder turn did, drawn under its reply: what it read, searched, changed in the PRD and
 * what failed.
 *
 * The receipt is built by the server from what actually happened, so it is the record — Builder's
 * own account of its turn is the reply above it, and the two are meant to be checked against each
 * other. That sets what is folded away and what is not:
 *
 * - The summary is one muted line and the long lists sit behind "Details" (a native `<details>`:
 *   keyboard-accessible, no state to keep). Reading and searching are what the admin will rarely
 *   audit.
 * - Failures, warnings and the reason the PRD did not change are never behind the toggle. A
 *   lookup that failed or an edit that never landed is exactly the thing a fluent reply papers
 *   over, so it has to be on screen without a click — and in words as well as colour.
 *
 * Anything that is not a readable receipt renders nothing.
 */
export const TurnReceipt: React.FC<TurnReceiptProps> = ({ receipt: raw }) => {
  const receipt = normalizeTurnReceipt(raw);
  if (!receipt) return null;

  const strings = en.builder.chat.receipt;
  const { read, searched, changed, failed, warnings, prdUnchangedBecause } = receipt;
  const summary = summaryOf(receipt);
  const hasDetails = read.length > 0 || searched.length > 0 || changed.length > 0;

  if (!summary && !failed.length && !warnings.length && !prdUnchangedBecause) return null;

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

      {prdUnchangedBecause && (
        <p className="break-words">{strings.prdUnchanged(prdUnchangedBecause)}</p>
      )}
    </div>
  );
};

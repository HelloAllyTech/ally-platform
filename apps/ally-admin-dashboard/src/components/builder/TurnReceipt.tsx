import React from "react";

import { en } from "@constants";
import type { BuilderTurnReceipt } from "@types";

import { normalizeTurnReceipt } from "../../utils/builderReceipt";
import { AgentReceipt } from "../agent-chat/AgentReceipt";

interface TurnReceiptProps {
  receipt: BuilderTurnReceipt | null | undefined;
}

/**
 * What one Builder turn did, drawn under its reply: the shared agent receipt in Builder's words,
 * with the PRD version as the summary's last group ("Read 3 · Searched 4 · Changed 2 sections ·
 * PRD v7 → v9") and "PRD unchanged" for the reason the admin's words changed nothing.
 *
 * Anything that is not a readable receipt renders nothing.
 */
export const TurnReceipt: React.FC<TurnReceiptProps> = ({ receipt: raw }) => {
  const receipt = normalizeTurnReceipt(raw);
  if (!receipt) return null;

  const strings = en.builder.chat.receipt;
  const { prdVersion, prdUnchangedBecause, ...lists } = receipt;
  return (
    <AgentReceipt
      receipt={{ ...lists, unchangedBecause: prdUnchangedBecause ?? undefined }}
      strings={{
        label: strings.label,
        read: strings.read,
        searched: strings.searched,
        changed: strings.changed,
        noActivity: strings.noActivity,
        noLookups: strings.noLookups,
        readHeading: strings.readHeading,
        searchedHeading: strings.searchedHeading,
        changedHeading: strings.changedHeading,
        failedHeading: strings.failedHeading,
        warningsHeading: strings.warningsHeading,
        unchanged: strings.prdUnchanged,
      }}
      extraSummary={
        prdVersion.from !== prdVersion.to
          ? strings.prdVersion(prdVersion.from, prdVersion.to)
          : null
      }
    />
  );
};

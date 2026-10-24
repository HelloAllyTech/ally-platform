import React from "react";

import { Pill, PillTone } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { AllyGuideReleaseStatus } from "@types";

/** Live is green, the stages before it are blue, retired is grey. The word always carries the meaning. */
const TONES: Record<AllyGuideReleaseStatus, PillTone> = {
  draft: "neutral",
  evaluating: "info",
  candidate: "info",
  shadow: "info",
  canary: "warning",
  ga: "success",
  retired: "neutral",
};

interface ReleaseStatusPillProps {
  status: AllyGuideReleaseStatus;
  /** A canary's share of new conversations, so the pill reads "Canary · 20%". */
  rolloutPercent?: number | null;
}

export const ReleaseStatusPill: React.FC<ReleaseStatusPillProps> = ({ status, rolloutPercent }) => (
  <Pill tone={TONES[status] ?? "neutral"}>
    {status === "canary"
      ? en.allyConsole.releases.canaryPill(rolloutPercent ?? null)
      : (en.allyConsole.releases.statuses[status] ?? status)}
  </Pill>
);

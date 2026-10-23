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

export const ReleaseStatusPill: React.FC<{ status: AllyGuideReleaseStatus }> = ({ status }) => (
  <Pill tone={TONES[status] ?? "neutral"}>
    {en.allyConsole.releases.statuses[status] ?? status}
  </Pill>
);

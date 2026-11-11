import React, { useEffect, useState } from "react";

import { AssistantLine, BuildSteps, Orb, PrimaryButton, useEnterToSubmit } from "@components/v2";

import { COPY } from "../copy";

// ── Building ──────────────────────────────────────────────────────────────

/** While the builder writes, the steps tick at a steady pace, short of the last until it's done. */
const useBuildTicks = (done: boolean): number => {
  const total = COPY.building.steps.length;
  const [ticked, setTicked] = useState(0);
  useEffect(() => {
    if (done) return undefined;
    const timer = setInterval(() => setTicked(n => Math.min(n + 1, total - 1)), 2500);
    return () => clearInterval(timer);
  }, [done, total]);
  return done ? total : ticked;
};

export const BuildingScreen: React.FC<{
  done: boolean;
  onContinue?: () => void;
  /** What the purpose set up (chunk 20a-2), once it's built. */
  confirmation?: string | null;
}> = ({ done, onContinue, confirmation }) => {
  const ticked = useBuildTicks(done);
  useEnterToSubmit(() => onContinue?.(), done && Boolean(onContinue));
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Orb size={44} working={!done} />
        <h1 className="ally-display" style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>
          {COPY.building.title}
        </h1>
      </div>
      <BuildSteps steps={[...COPY.building.steps]} done={ticked} />
      {done && confirmation && <AssistantLine>{confirmation}</AssistantLine>}
      {done && onContinue && (
        <PrimaryButton enterHint={COPY.frame.enterHint} onClick={onContinue}>
          {COPY.frame.buildingDone}
        </PrimaryButton>
      )}
    </>
  );
};

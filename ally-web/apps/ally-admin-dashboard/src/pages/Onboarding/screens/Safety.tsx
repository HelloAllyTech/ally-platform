import React from "react";

import {
  AssistantLine,
  PrimaryButton,
  SafetyCard as SafetyCardView,
  useEnterToSubmit,
} from "@components/v2";

import { PackChoices } from "../../AssistantHome/sections/Safety";
import { COPY, fill } from "../copy";
import { withBold } from "./text";

import type { BotDraftView } from "../types";

// ── 4. Safety ─────────────────────────────────────────────────────────────

export const SafetyScreen: React.FC<{
  view: BotDraftView;
  line?: string;
  onContinue?: () => void;
  /** Q4 A3: "This isn't right for my business"; rejects with the server's reason. */
  onChoosePack?: (pack: string, reason?: string) => Promise<void>;
  choosing?: boolean;
}> = ({ view, line, onContinue, onChoosePack, choosing = false }) => {
  const pack = view.safety;
  useEnterToSubmit(() => onContinue?.(), Boolean(onContinue && pack));
  if (!pack) return null;
  return (
    <>
      {line && <AssistantLine>{withBold(line)}</AssistantLine>}
      <SafetyCardView
        title={fill(COPY.safety.title, { "Pack name": pack.name })}
        body={fill(COPY.safety.body, { industry: pack.industryLabel })}
        panels={{
          always: COPY.safety.always,
          never: COPY.safety.never,
          atRisk: COPY.safety.atRisk,
        }}
        always={pack.always}
        never={pack.never}
        atRisk={pack.atRisk}
        toggleLabel={COPY.safety.link}
      />
      {onChoosePack && (pack.choices?.length ?? 0) > 0 && (
        <PackChoices
          choices={pack.choices ?? []}
          currentId={pack.id}
          busy={choosing}
          onChange={onChoosePack}
        />
      )}
      {onContinue && (
        <PrimaryButton enterHint={COPY.frame.enterHint} onClick={onContinue}>
          {COPY.frame.safetyContinue}
        </PrimaryButton>
      )}
    </>
  );
};

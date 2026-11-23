import React from "react";

import { CheckupSection } from "./Checkup";
import { PersonalitySection } from "./Personality";
import { ChatbotBuild } from "../../Onboarding/create/ChatbotBuild";
import { Parts } from "../ui/Parts";

import type { SectionProps } from "./props";
import type { BuildPart } from "../sections";

/**
 * Build (stage 3): for an editor, the same Create and Build screen as a new chatbot, opened on this
 * chatbot's working copy (Copilot or the form beside the test chatbot, Apply once it is live).
 * Check-up puts the crisis check and ten likely questions first, with the saved tests under
 * "Advanced". Viewers, and an archived chatbot, keep the read-only Personality and Check-up.
 */
export const BuildSection: React.FC<
  SectionProps & { part: BuildPart; onPart: (part: BuildPart) => void }
> = ({ part, onPart, ...props }) => (
  <>
    <Parts parts={["personality", "checkup"]} value={part} onChange={onPart} testId="build-parts" />
    <div id={`part-panel-${part}`} role="tabpanel" aria-labelledby={`part-tab-${part}`}>
      {!props.canEdit ? (
        part === "checkup" ? (
          <CheckupSection {...props} />
        ) : (
          <PersonalitySection {...props} />
        )
      ) : (
        <ChatbotBuild
          chatbotId={props.bot.id}
          canEdit={props.canEdit}
          archived={Boolean(props.bot.archivedAt)}
          part={part === "checkup" ? "checkup" : "screen"}
          advanced={part === "checkup" ? <CheckupSection {...props} /> : undefined}
        />
      )}
    </div>
  </>
);

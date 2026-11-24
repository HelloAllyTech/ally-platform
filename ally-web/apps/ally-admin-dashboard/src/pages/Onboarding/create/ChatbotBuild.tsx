import React from "react";

import { useGetChatbotWorkingCopyQuery } from "@api";
import { Button, Orb } from "@components/v2";

import { BuildScreen } from "./BuildScreen";
import { CheckupUpFront } from "./CheckupUpFront";
import { BUILD_COPY } from "./copy";

import "./build.css";

/**
 * An existing chatbot's Build (stage 3, "Same screen as Build"): its working copy is found (or
 * created from the live chatbot) by chatbot id, then the same Create and Build screen opens on it,
 * without the start options once the chatbot has content.
 */
export const ChatbotBuild: React.FC<{
  chatbotId: string;
  canEdit: boolean;
  archived: boolean;
  part: "screen" | "checkup";
  /** The saved tests, under "Advanced" in the Check-up. */
  advanced?: React.ReactNode;
}> = ({ chatbotId, canEdit, archived, part, advanced }) => {
  const wc = useGetChatbotWorkingCopyQuery(chatbotId);
  if (!wc.data) {
    return (
      <div className="ally-v2 ally-build ally-build--loading" data-testid="chatbot-build-loading">
        {wc.isError ? (
          <p className="ally-error" role="alert">
            {BUILD_COPY.loadFailed}{" "}
            <Button variant="ghost" onClick={() => void wc.refetch()}>
              {BUILD_COPY.retry}
            </Button>
          </p>
        ) : (
          <Orb size={40} working />
        )}
      </div>
    );
  }
  if (part === "checkup") {
    return (
      <div className="ally-v2 ally-build">
        <CheckupUpFront
          chatbotId={chatbotId}
          draftId={wc.data.draftId}
          canEdit={canEdit && !archived}
        />
        {advanced && (
          <details className="ally-build__section" data-testid="checkup-advanced">
            <summary className="ally-build__section-title">{BUILD_COPY.checkup.advanced}</summary>
            {advanced}
          </details>
        )}
      </div>
    );
  }
  return (
    <div className="ally-build__home">
      {/* Keyed by working copy: the remembered mode and start state belong to one chatbot, so
          moving to another never carries the last one's mode (Copilot) across. */}
      <BuildScreen
        key={wc.data.draftId}
        draftId={wc.data.draftId}
        canEdit={canEdit && !archived}
        archived={archived}
        surface="build"
      />
    </div>
  );
};

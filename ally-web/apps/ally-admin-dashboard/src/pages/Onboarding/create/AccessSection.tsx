import React from "react";

import { useGetChatbotQuery } from "@api";

import { WhoMayChat } from "../../AssistantHome/sections/WhoMayChat";
import { BUILD_COPY } from "./copy";

import type { SectionProps } from "../../AssistantHome/sections/props";

/**
 * The form's "Who may chat": the real access list (Channels → Who may chat, stage 6) for this
 * chatbot. Before the chatbot exists there is nothing to list yet.
 */
export const AccessSection: React.FC<{ chatbotId: string | null; canEdit: boolean }> = ({
  chatbotId,
  canEdit,
}) => {
  const { data: bot } = useGetChatbotQuery(chatbotId ?? "", { skip: !chatbotId });
  if (!bot) {
    return (
      <p className="ally-small" data-testid="access-placeholder">
        {BUILD_COPY.accessPlaceholder}
      </p>
    );
  }
  // WhoMayChat reads only the chatbot and whether the viewer may edit.
  return <WhoMayChat {...({ bot, canEdit } as SectionProps)} />;
};

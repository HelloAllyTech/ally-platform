import React from "react";

import { useNavigate } from "react-router-dom";

import { useGetChatbotsQuery } from "@api";
import { ROUTES } from "@constants";

import { BotSettingsTab } from "./BotSettingsTab";
import { AllConnectorsTab } from "./ConnectorsTab";
import { CorpusTab } from "./CorpusTab";
import { DEFAULTS_COPY } from "./defaultsCopy";
import { TemplatesTab } from "./TemplatesTab";

import "./list-page.css";

/**
 * Staff only. The screens every chatbot inherits from, shown as views of Assistants admin →
 * Defaults & library (`pages/AssistantsAdmin`). They used to be one page of their own; the
 * system grant that gates them is checked there and by ally-be.
 */

/** Starting settings: what each new chatbot copies when it is created. */
export const StartingSettingsPanel: React.FC = () => (
  <div className="ally-v2 flex flex-col gap-4" data-testid="defaults-panel-settings">
    <p className="text-sm text-typography-600 max-w-3xl">{DEFAULTS_COPY.intro}</p>
    <BotSettingsTab />
  </div>
);

/** Quick replies: the fixed replies every chatbot shares, including the locked safety ones. */
export const QuickRepliesPanel: React.FC = () => (
  <div className="ally-v2 flex flex-col gap-4" data-testid="defaults-panel-replies">
    <p className="text-sm text-typography-600 max-w-3xl">{DEFAULTS_COPY.repliesIntro}</p>
    <TemplatesTab />
  </div>
);

/** The shared knowledge library every chatbot can draw on. */
export const KnowledgeLibraryPanel: React.FC = () => (
  <div className="ally-v2" data-testid="defaults-panel-library">
    <CorpusTab />
  </div>
);

/** Every WhatsApp number and which chatbot answers it. */
export const ChannelsPanel: React.FC = () => {
  const { data } = useGetChatbotsQuery();
  const navigate = useNavigate();
  return (
    <div className="ally-v2" data-testid="defaults-panel-channels">
      <AllConnectorsTab
        bots={data?.chatbots ?? []}
        onCreateAgent={() => navigate(ROUTES.CHATBOT_NEW)}
      />
    </div>
  );
};

import React from "react";

import { ConversationsTab } from "../../WhatsAppBot/ConversationsTab";
import { HOME } from "../copy";
import { SectionHead } from "../fields";
import { sectionFromUrl } from "../sections";

import type { SectionProps } from "./props";

/** What people asked and what the assistant said: the conversation list and its thread drawer. */
export const ConversationsSection: React.FC<SectionProps> = ({ bot, go }) => (
  <>
    <SectionHead title={HOME.sections.conversations} subtitle={HOME.subtitles.conversations} />
    <div className="ally-card ally-home__classic">
      {/* Its links name the classic tabs; each lands on the section that holds it now. */}
      <ConversationsTab
        bot={bot}
        onGo={id => go(sectionFromUrl(new URLSearchParams({ tab: id })).section)}
      />
    </div>
  </>
);

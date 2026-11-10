import React from "react";

import { Inbox } from "../../Inbox";
import { HOME } from "../copy";
import { SectionHead } from "../fields";

import type { SectionProps } from "./props";

/**
 * This assistant's inbox (chunk 11a): its chats from every channel, live, to take over and reply.
 * The same inbox as AI Chatbots → Inbox, held to this assistant. The old list and drawer stay on
 * the classic view (`?view=classic`).
 */
export const ConversationsSection: React.FC<SectionProps> = ({ bot }) => (
  <>
    <SectionHead
      title={HOME.sections.conversations}
      subtitle={HOME.subtitles.conversations}
      help={HOME.help.conversations}
    />
    {/* The app bar, the assistant's header and this title sit above the panel: about 260px. */}
    <div style={{ ["--ally-inbox-top" as string]: "260px" }}>
      <Inbox chatbotId={bot.id} />
    </div>
  </>
);

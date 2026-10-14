import React from "react";

import { en } from "@constants";

import { ChatComposer as AgentChatComposer } from "../agent-chat/ChatComposer";

type ChatComposerProps = Omit<
  React.ComponentProps<typeof AgentChatComposer>,
  "placeholder" | "editableWhileStreaming"
>;

/**
 * The interview's composer: the shared one in the interview's wording, left editable while the
 * agent replies so the next answer can be drafted.
 */
export const ChatComposer: React.FC<ChatComposerProps> = props => (
  <AgentChatComposer
    {...props}
    placeholder={en.characterInterview.chat.placeholder}
    editableWhileStreaming
  />
);

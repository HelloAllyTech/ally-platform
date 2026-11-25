import React from "react";

import { EmptyChatbots } from "@assets";

/** The picture for when there is no chatbot to open yet. Decorative only. */
export const EmptyChatbotsArt: React.FC = () => (
  <img
    src={EmptyChatbots}
    alt=""
    width={200}
    height={200}
    draggable={false}
    data-testid="empty-chatbots-art"
  />
);

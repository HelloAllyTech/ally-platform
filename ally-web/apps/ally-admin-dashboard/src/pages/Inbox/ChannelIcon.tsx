import React from "react";

import { channelLabel } from "./copy";

/**
 * A chat's channel as a small icon with its name for screen readers (chunk 20d-2): WhatsApp, the
 * bot page, or the website widget.
 */
export const ChannelIcon: React.FC<{ chat: { channel: string; source?: "widget" | null } }> = ({
  chat,
}) => {
  const label = channelLabel(chat);
  const kind = chat.source === "widget" ? "widget" : chat.channel === "web" ? "page" : "whatsapp";
  return (
    <span className={`ally-channel ally-channel--${kind}`} title={label}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
        {kind === "whatsapp" ? (
          <path
            d="M8 1.6a6.4 6.4 0 0 0-5.5 9.7L1.6 14.4l3.2-.9A6.4 6.4 0 1 0 8 1.6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        ) : kind === "page" ? (
          <>
            <rect
              x="2"
              y="2.5"
              width="12"
              height="11"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path d="M2 5.5h12" stroke="currentColor" strokeWidth="1.4" />
          </>
        ) : (
          <>
            <rect
              x="1.8"
              y="3"
              width="12.4"
              height="8.6"
              rx="1.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <circle cx="11.6" cy="12.6" r="2.2" fill="currentColor" />
          </>
        )}
      </svg>
      <span className="ally-sr-only">{label}</span>
    </span>
  );
};

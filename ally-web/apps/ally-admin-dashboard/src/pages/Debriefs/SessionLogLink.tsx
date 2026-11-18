import React from "react";

import { en, ROUTES } from "@constants";

/**
 * The roleplay itself — transcript, audio and scored events — in a new tab, so
 * a reviewer can check the debrief against what actually happened.
 */
export const SessionLogLink: React.FC<{ sessionId: string }> = ({ sessionId }) => (
  <a
    href={ROUTES.ROLEPLAY_SESSION_LOG_DETAIL(sessionId)}
    target="_blank"
    rel="noreferrer"
    className="text-primary-600 underline"
  >
    {en.debriefs.run.sessionLog}
  </a>
);

import React from "react";

import { Link } from "react-router-dom";

// The constants' own files, not the `@constants` barrel: this is drawn in tests without the store.
import { ROUTES } from "../../constants/common";
import { en } from "../../constants/en";

/** 404 (how ally-be hides a bot from someone not on its team) or 403: no access (A1). */
export const isNoAccess = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | undefined)?.status;
  return status === 404 || status === 403;
};

/** "You don't have access to this assistant", with a link to the caller's own (A1). */
export const NoAccess: React.FC = () => (
  <div
    className="flex flex-col items-start gap-3 p-6"
    data-testid="assistant-no-access"
    role="status"
  >
    <p className="ally-body">{en.assistantsShell.noAccess}</p>
    <Link className="ally-link" to={ROUTES.WHATSAPP_BOT}>
      {en.assistantsShell.toYourAssistants}
    </Link>
  </div>
);

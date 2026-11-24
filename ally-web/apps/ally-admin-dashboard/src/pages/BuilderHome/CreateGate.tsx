import React from "react";

import { Link } from "react-router-dom";

import { ROUTES } from "@constants";

import { BUILDER_HOME, CREATE_MIN_WIDTH } from "./copy";
import { useMedia } from "../AssistantHome/userLists/useMedia";

/**
 * Wraps the create screen (stage 2): below 1280px it renders an "open on a laptop" message and
 * mounts nothing, so no blank chatbot is created that cannot be built. A bookmark or a typed
 * address is held back the same as the home's Create button.
 */
export const CreateGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const roomy = useMedia(`(min-width: ${CREATE_MIN_WIDTH}px)`);
  if (roomy) return <>{children}</>;
  return (
    <div className="ally-v2 ally-list-page" data-testid="create-narrow">
      <div className="ally-card ally-list-page__choice" role="status">
        <div>
          <h1 className="ally-heading">{BUILDER_HOME.narrow.title}</h1>
          <p className="ally-small">{BUILDER_HOME.narrow.body}</p>
        </div>
        <Link to={ROUTES.WHATSAPP_BOT} className="ally-link">
          {BUILDER_HOME.create.openLink}
        </Link>
      </div>
    </div>
  );
};

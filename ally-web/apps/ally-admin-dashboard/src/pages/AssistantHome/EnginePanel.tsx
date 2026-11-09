import React from "react";

import { Button } from "@components/v2";
import type { Chatbot } from "@types";

import { HOME } from "./copy";
import { AgentTab } from "../WhatsAppBot/AgentTab";

/**
 * How the assistant answers (answer mode, model, temperature): platform admins only, from the
 * header (chunk 20d §4.1.6). Owners never see this panel or its words.
 */
export const EnginePanel: React.FC<{ bot: Chatbot; onClose: () => void; onTry: () => void }> = ({
  bot,
  onClose,
  onTry,
}) => (
  <div className="ally-home__engine" data-testid="engine-panel">
    <div className="ally-home__panel-head">
      <div>
        <h2 className="ally-heading ally-home__panel-title">{HOME.admin.engine}</h2>
        <p className="ally-small">{HOME.admin.engineHint}</p>
      </div>
      <Button onClick={onClose}>{HOME.tryPanel.close}</Button>
    </div>
    <div className="ally-home__classic">
      <AgentTab bot={bot} canEdit onTest={onTry} />
    </div>
  </div>
);

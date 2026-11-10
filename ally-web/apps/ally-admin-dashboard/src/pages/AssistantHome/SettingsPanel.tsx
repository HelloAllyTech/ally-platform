import React from "react";

import { Button } from "@components/v2";
import type { Chatbot } from "@types";

import { HOME } from "./copy";
import { ChatbotSettingsTab } from "../WhatsAppBot/ChatbotSettingsTab";

/**
 * This assistant's own engine settings (WhatsApp replies on or off, typing, consent, the crisis
 * check, helpline numbers, limits and retrieval): platform admins only, from the header's `···`
 * menu. The classic Settings tab, moved as is when the classic view went (CL1); Defaults sets the
 * same values for every assistant at once.
 */
export const SettingsPanel: React.FC<{ bot: Chatbot; onClose: () => void }> = ({
  bot,
  onClose,
}) => (
  <div className="ally-home__engine" data-testid="settings-panel">
    <div className="ally-home__panel-head">
      <div>
        <h2 className="ally-heading ally-home__panel-title">{HOME.admin.settings}</h2>
        <p className="ally-small">{HOME.admin.settingsHint}</p>
      </div>
      <Button onClick={onClose}>{HOME.tryPanel.close}</Button>
    </div>
    <div className="ally-home__classic">
      <ChatbotSettingsTab chatbotId={bot.id} chatbotName={bot.name} canEdit isPlatformAdmin />
    </div>
  </div>
);

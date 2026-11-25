/**
 * The existing staff screens, re-exported as panels for Assistants admin. Each is the same screen
 * that used to have its own sidebar item, shown without its own page title (the section header
 * stands in for it). Nothing here changes what a screen does.
 */
import React from "react";

import { BillingCosts } from "../../Billing/Costs";
import { ModelsTab } from "../../Billing/Models/ModelsTab";
import { WhatsAppRatesTab } from "../../Billing/Models/WhatsAppRatesTab";
import { BillingPlans } from "../../Billing/Plans";
import { ChatbotSupportSearch } from "../../ChatbotSupport/ChatbotSupport";
import { StaffCredits } from "../../Credits/StaffCredits";
import { SafetyPacks } from "../../SafetyPacks/SafetyPacks";
import {
  ChannelsPanel,
  KnowledgeLibraryPanel,
  QuickRepliesPanel,
  StartingSettingsPanel,
} from "../../WhatsAppBot/AssistantDefaults";

export const CreditsPanel: React.FC = () => <StaffCredits embedded />;
export const CostsPanel: React.FC = () => <BillingCosts embedded />;
export const ModelPricesPanel: React.FC = () => <ModelsTab />;
export const WhatsAppRatesPanel: React.FC = () => <WhatsAppRatesTab />;
export const PlansPanel: React.FC = () => <BillingPlans embedded />;
export const SafetyPacksPanel: React.FC = () => <SafetyPacks embedded />;
export const StartingSettingsView = StartingSettingsPanel;
export const QuickRepliesView = QuickRepliesPanel;
export const KnowledgeLibraryView = KnowledgeLibraryPanel;
export const ChannelsView = ChannelsPanel;
export const SupportPanel: React.FC = () => <ChatbotSupportSearch embedded />;

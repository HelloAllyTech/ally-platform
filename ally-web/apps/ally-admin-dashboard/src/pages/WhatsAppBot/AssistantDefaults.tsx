import React, { useState } from "react";

import { useNavigate } from "react-router-dom";

import { useGetChatbotsQuery } from "@api";
import { en, ROUTES } from "@constants";

import { BotSettingsTab } from "./BotSettingsTab";
import { AllConnectorsTab } from "./ConnectorsTab";
import { CorpusTab } from "./CorpusTab";
import { DEFAULTS_COPY } from "./defaultsCopy";
import { TemplatesTab } from "./TemplatesTab";

import "./list-page.css";

const t = en.whatsappBot.bots;
const d = en.assistantDefaults;

type StaffTab = "defaults" | "library" | "connectors";

/**
 * Staff only (stage 2). The Defaults, Library and Connectors screens that used to be tabs on the
 * assistants home, moved off the builder's own UI. The route is gated by `system:access` (see
 * RouteLayout) and linked only from the admin sidebar for staff.
 */
export const AssistantDefaults: React.FC = () => {
  const [tab, setTab] = useState<StaffTab>("defaults");
  const { data } = useGetChatbotsQuery();
  const navigate = useNavigate();
  const items: { id: StaffTab; label: string }[] = [
    { id: "defaults", label: d.tabs.defaults },
    { id: "library", label: d.tabs.library },
    { id: "connectors", label: d.tabs.connectors },
  ];
  return (
    <div className="ally-v2 ally-list-page" data-testid="assistant-defaults">
      <header className="ally-list-page__head">
        <div className="ally-list-page__title">
          <h1 className="ally-display">{d.title}</h1>
          <p className="ally-small">{d.subtitle}</p>
        </div>
      </header>
      <div className="ally-list-page__tabs" role="tablist" data-testid="staff-tabs">
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-testid={`staff-tab-${item.id}`}
            aria-selected={item.id === tab}
            className="ally-list-page__tab"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="ally-list-page__body">
        {tab === "defaults" && <DefaultsTab />}
        {tab === "library" && <CorpusTab />}
        {tab === "connectors" && (
          <AllConnectorsTab
            bots={data?.chatbots ?? []}
            onCreateAgent={() => navigate(ROUTES.CHATBOT_NEW)}
          />
        )}
      </div>
    </div>
  );
};

/**
 * Defaults: what every agent starts from, split into its two halves so neither page is long —
 * the settings, and the quick replies every agent shares.
 */
const DefaultsTab: React.FC = () => {
  const [section, setSection] = useState<"settings" | "replies">("settings");
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-typography-600 max-w-3xl">{DEFAULTS_COPY.intro}</p>
      <div className="inline-flex w-fit rounded-md border border-border-light p-0.5" role="tablist">
        {(["settings", "replies"] as const).map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className={`px-4 py-1.5 text-sm rounded ${
              section === id
                ? "bg-primary-500 text-white"
                : "text-typography-700 hover:bg-neutral-50"
            }`}
          >
            {id === "settings" ? t.defaults.sectionSettings : t.defaults.sectionReplies}
          </button>
        ))}
      </div>
      {section === "settings" ? (
        <BotSettingsTab />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-typography-600 max-w-3xl">{DEFAULTS_COPY.repliesIntro}</p>
          <TemplatesTab />
        </div>
      )}
    </div>
  );
};

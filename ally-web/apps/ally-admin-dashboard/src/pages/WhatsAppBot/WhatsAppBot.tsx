import React, { useCallback, useMemo, useState } from "react";

import { useNavigate, useSearchParams } from "react-router-dom";

import { useGetChatbotsQuery } from "@api";
import { EmptyState } from "@components";
import { Button as V2Button } from "@components/v2";
import { en, ROUTES } from "@constants";
import { Chatbot, ChatbotStatus } from "@types";

import { BotSettingsTab } from "./BotSettingsTab";
import { AllConnectorsTab } from "./ConnectorsTab";
import { CorpusTab } from "./CorpusTab";
import { fill, LoadError } from "./shared";
import { TemplatesTab } from "./TemplatesTab";
import { Inbox } from "../Inbox";
import { COPY as ONBOARDING_COPY } from "../Onboarding/copy";

import "../AssistantHome/ui/scale.css";
import "./list-page.css";

const t = en.whatsappBot.bots;

type HomeTab = "bots" | "inbox" | "connectors" | "defaults" | "library";

/**
 * Chatbots home.
 *
 * Everyone sees the bots they can work on, as cards. Platform admins — who create bots and own
 * what every bot shares — also get the connectors (every number, and which bot it serves), the
 * defaults every bot inherits (settings and shared quick replies), and the
 * knowledge library bots pick their documents from.
 *
 * Gated in two places, matching every other feature-toggle-gated page here: the `whatsapp_bot`
 * entry in `buildSidebarItemFeatureKeyMap` hides the sidebar entry, and `requiredFeature` on the
 * route in RouteLayout blocks direct navigation.
 */
export const WhatsAppBot: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, isError, refetch } = useGetChatbotsQuery();
  const navigate = useNavigate();
  const canCreate = Boolean(data?.canCreate);

  // The inbox (chunk 11a) is for everyone who can see an assistant: its chats, every channel.
  const tabItems = useMemo(
    () =>
      canCreate
        ? [
            { id: "bots", label: t.homeTabs.bots },
            { id: "inbox", label: t.homeTabs.inbox },
            { id: "connectors", label: t.homeTabs.connectors },
            { id: "defaults", label: t.homeTabs.defaults },
            { id: "library", label: t.homeTabs.library },
          ]
        : [
            { id: "bots", label: t.homeTabs.bots },
            { id: "inbox", label: t.homeTabs.inbox },
          ],
    [canCreate],
  );
  const requested = searchParams.get("tab") ?? "bots";
  const activeTab = (tabItems.find(tab => tab.id === requested)?.id ?? "bots") as HomeTab;
  const goToTab = useCallback(
    (id: string) => setSearchParams(id === "bots" ? {} : { tab: id }),
    [setSearchParams],
  );

  // Chunk 20d-2: the page in the v2 look (DESIGN.md), like the assistant's own home.
  return (
    <div className="ally-v2 ally-list-page">
      <header className="ally-list-page__head">
        <div className="ally-list-page__title">
          <h1 className="ally-display">{en.whatsappBot.title}</h1>
          <p className="ally-small">{en.whatsappBot.subtitle}</p>
        </div>
        {/* Onboarding is the only way to make an assistant (chunk 20d). */}
        <V2Button variant="primary" onClick={() => navigate(ROUTES.CHATBOT_NEW)}>
          {ONBOARDING_COPY.newAssistant}
        </V2Button>
      </header>
      {tabItems.length > 1 && (
        <div className="ally-list-page__tabs" role="tablist" data-testid="tabs">
          {tabItems.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-testid={`tab-${tab.id}`}
              aria-selected={tab.id === activeTab}
              className="ally-list-page__tab"
              onClick={() => goToTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div className="ally-list-page__body">
        {activeTab === "bots" &&
          (isLoading ? (
            <div className="ally-list-page__grid" aria-busy="true">
              {[0, 1, 2].map(n => (
                <span
                  key={n}
                  className="ally-card ally-list-page__card ally-list-page__card--skeleton"
                />
              ))}
            </div>
          ) : isError ? (
            <LoadError title={t.loadFailed} onRetry={() => void refetch()} />
          ) : (
            <ChatbotGrid
              bots={data?.chatbots ?? []}
              canCreate={canCreate}
              onCreate={() => navigate(ROUTES.CHATBOT_NEW)}
            />
          ))}
        {activeTab === "connectors" && (
          <AllConnectorsTab
            bots={data?.chatbots ?? []}
            onCreateAgent={() => navigate(ROUTES.CHATBOT_NEW)}
          />
        )}
        {activeTab === "inbox" && (
          // Everything above the panel (the app bar, this title and the tabs) is about 240px.
          <div style={{ ["--ally-inbox-top" as string]: "240px" }}>
            <Inbox />
          </div>
        )}
        {activeTab === "defaults" && <DefaultsTab />}
        {activeTab === "library" && <CorpusTab />}
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
      <p className="text-sm text-typography-600 max-w-3xl">{t.defaults.intro}</p>
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
          <p className="text-sm text-typography-600 max-w-3xl">{t.defaults.repliesIntro}</p>
          <TemplatesTab />
        </div>
      )}
    </div>
  );
};

const ChatbotGrid: React.FC<{ bots: Chatbot[]; canCreate: boolean; onCreate: () => void }> = ({
  bots,
  canCreate,
  onCreate,
}) => {
  const navigate = useNavigate();
  if (!bots.length) {
    return (
      <EmptyState
        title={canCreate ? t.listEmpty : t.listEmptyMember}
        subtitle={canCreate ? t.listEmptyHint : t.listEmptyMemberHint}
        actionLabel={t.create}
        onAction={onCreate}
        hideActionButton={!canCreate}
      />
    );
  }
  return (
    <div className="ally-list-page__grid">
      {bots.map(bot => (
        <button
          key={bot.id}
          type="button"
          onClick={() =>
            // An unfinished setup opens where it left off (chunk 20a), not the bot's page.
            navigate(
              bot.status === ChatbotStatus.DRAFT && bot.setupDraftId
                ? ROUTES.CHATBOT_NEW_SESSION(bot.setupDraftId)
                : ROUTES.CHATBOT_DETAIL.replace(":botId", bot.id),
            )
          }
          className="ally-card ally-list-page__card"
        >
          <span className="ally-list-page__card-top">
            <span className="ally-list-page__name">
              <span className="ally-list-page__bot">{bot.name}</span>
              {bot.persona.displayName && bot.persona.displayName !== bot.name && (
                <span className="ally-small">{bot.persona.displayName}</span>
              )}
            </span>
            <span
              className={`ally-badge ally-list-page__status ally-list-page__status--${bot.status}`}
            >
              {t.status[bot.status]}
            </span>
          </span>
          {bot.description && (
            <span className="ally-small ally-list-page__desc">{bot.description}</span>
          )}
          <span className="ally-list-page__channels">
            {bot.connectors.length ? (
              bot.connectors.map(connector => (
                <span key={connector.id} className="ally-badge ally-badge--muted">
                  {connector.typeLabel} {connector.summary?.address ?? ""}
                </span>
              ))
            ) : (
              <span className="ally-small">{t.noConnector}</span>
            )}
          </span>
          <span className="ally-list-page__stats ally-small">
            <span>{fill(t.cardMessages, { count: bot.stats.messages })}</span>
            <span>{fill(t.cardPeople, { count: bot.stats.people })}</span>
            {bot.status === ChatbotStatus.DRAFT && bot.setupDraftId && (
              <span className="ally-list-page__continue">{ONBOARDING_COPY.continueSetup}</span>
            )}
            <span className="ally-list-page__role">{t.role[bot.myRole]}</span>
          </span>
        </button>
      ))}
    </div>
  );
};

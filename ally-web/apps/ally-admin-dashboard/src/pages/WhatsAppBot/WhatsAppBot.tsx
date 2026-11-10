import React, { useCallback, useMemo, useState } from "react";

import { useNavigate, useSearchParams } from "react-router-dom";

import { SkeletonText, Tabs } from "@ally-ui-mono/ui-shared";
import { useGetChatbotsQuery } from "@api";
import { Button, EmptyState } from "@components";
import { ButtonVariant } from "@components/types";
import { en, ROUTES } from "@constants";
import { Chatbot, ChatbotStatus } from "@types";

import { BotSettingsTab } from "./BotSettingsTab";
import { AllConnectorsTab } from "./ConnectorsTab";
import { CorpusTab } from "./CorpusTab";
import { fill, LoadError, StatusPill } from "./shared";
import { TemplatesTab } from "./TemplatesTab";
import { Inbox } from "../Inbox";
import { COPY as ONBOARDING_COPY } from "../Onboarding/copy";

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

  return (
    <div className="py-[2px] font-primary relative">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl text-typography-900 font-secondary">{en.whatsappBot.title}</h1>
          <p className="text-sm text-typography-600">{en.whatsappBot.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Onboarding is the only way to make an assistant (chunk 20d). */}
          <Button variant={ButtonVariant.PRIMARY} onClick={() => navigate(ROUTES.CHATBOT_NEW)}>
            {ONBOARDING_COPY.newAssistant}
          </Button>
        </div>
      </div>
      {tabItems.length > 1 && (
        <Tabs items={tabItems} activeId={activeTab} onChange={goToTab} showCount={false} />
      )}
      <div className="pt-6">
        {activeTab === "bots" &&
          (isLoading ? (
            <SkeletonText paragraph lineCount={6} />
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
          // Everything above the panel (the app bar, this title and the tabs) is about 250px.
          <div style={{ ["--ally-inbox-top" as string]: "250px" }}>
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

const STATUS_TONE: Record<ChatbotStatus, "success" | "warning" | "neutral"> = {
  [ChatbotStatus.LIVE]: "success",
  [ChatbotStatus.DRAFT]: "neutral",
  [ChatbotStatus.PAUSED]: "warning",
};

export const ChatbotStatusPill: React.FC<{ status: ChatbotStatus }> = ({ status }) => (
  <StatusPill tone={STATUS_TONE[status]}>{t.status[status]}</StatusPill>
);

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
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
          className="flex flex-col gap-3 text-left border border-border-light rounded-md p-5 hover:bg-neutral-50 min-w-0"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-base text-typography-900 font-secondary truncate">
                {bot.name}
              </span>
              {bot.persona.displayName && bot.persona.displayName !== bot.name && (
                <span className="text-xs text-typography-500 truncate">
                  {bot.persona.displayName}
                </span>
              )}
            </div>
            <ChatbotStatusPill status={bot.status} />
          </div>
          {bot.description && (
            <p className="text-sm text-typography-600 line-clamp-2">{bot.description}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {bot.connectors.length ? (
              bot.connectors.map(connector => (
                <span
                  key={connector.id}
                  className="text-xs px-2 py-[2px] rounded-full bg-background-100 text-typography-800"
                >
                  {connector.typeLabel} {connector.summary?.address ?? ""}
                </span>
              ))
            ) : (
              <span className="text-xs text-typography-500">{t.noConnector}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-typography-600">
            <span>{fill(t.cardMessages, { count: bot.stats.messages })}</span>
            <span>{fill(t.cardPeople, { count: bot.stats.people })}</span>
            <span>{fill(t.cardDocs, { count: bot.documentCount })}</span>
            {bot.status === ChatbotStatus.DRAFT && bot.setupDraftId && (
              <span className="font-semibold text-primary-700 underline">
                {ONBOARDING_COPY.continueSetup}
              </span>
            )}
            <span className="ml-auto text-typography-500">{t.role[bot.myRole]}</span>
          </div>
        </button>
      ))}
    </div>
  );
};

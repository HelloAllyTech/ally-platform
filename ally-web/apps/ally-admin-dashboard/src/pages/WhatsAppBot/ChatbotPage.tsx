import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Link, useParams, useSearchParams } from "react-router-dom";

import { SkeletonText, Tabs } from "@ally-ui-mono/ui-shared";
import { useGetChatbotQuery, useGetChatbotsQuery } from "@api";
import { en, ROUTES } from "@constants";
import { Chatbot, ChatbotMemberRole } from "@types";

import { AgentTab } from "./AgentTab";
import { BotPageTab } from "./BotPageTab";
import { ChatbotContext } from "./chatbotContext";
import { ChatbotOverviewTab } from "./ChatbotOverviewTab";
import { ChatbotSettingsTab } from "./ChatbotSettingsTab";
import { ChatbotTestTab } from "./ChatbotTestTab";
import { BotConnectorsTab } from "./ConnectorsTab";
import { ConversationsTab } from "./ConversationsTab";
import { KnowledgeTab } from "./KnowledgeTab";
import { LookAndFeelSection } from "./LookAndFeel";
import { PeopleTab } from "./PeopleTab";
import { PersonaTab } from "./PersonaTab";
import { clearPreviewDraft } from "./previewDraft";
import { LoadError } from "./shared";
import { TemplatesTab } from "./TemplatesTab";
import { UnansweredTab } from "./UnansweredTab";
import { UnsavedChangesContext } from "./unsavedChanges";
import { UsageTab } from "./UsageTab";
import { ChatbotStatusPill } from "./WhatsAppBot";

const t = en.whatsappBot.bots;

export type ChatbotTabId = keyof typeof t.tabs;
export type ChatbotSettingsSectionId = keyof typeof t.settingsSections;

const TAB_ORDER: ChatbotTabId[] = [
  "overview",
  "persona",
  "knowledge",
  "test",
  "conversations",
  "unanswered",
  "usage",
  "settings",
];

const SECTION_ORDER: ChatbotSettingsSectionId[] = [
  "agent",
  "replies",
  "people",
  "connectors",
  "botPage",
  "lookAndFeel",
  "general",
];

const isSection = (id: string | null): id is ChatbotSettingsSectionId =>
  Boolean(id) && SECTION_ORDER.includes(id as ChatbotSettingsSectionId);

const RANK: Record<ChatbotMemberRole, number> = {
  [ChatbotMemberRole.VIEWER]: 1,
  [ChatbotMemberRole.EDITOR]: 2,
  [ChatbotMemberRole.OWNER]: 3,
};

const canDo = (bot: Pick<Chatbot, "myRole">, role: ChatbotMemberRole) =>
  RANK[bot.myRole] >= RANK[role];

/**
 * One chatbot: the same tabs for every bot, with its configuration (agent, quick replies, access,
 * channels, general settings) as sections of Settings so the tab row stays short. Everything inside reads
 * the bot from ChatbotContext, and every action is offered only to the roles the backend accepts
 * it from — a viewer sees the bot and can test it, an editor changes it, an owner also manages its
 * team and channels. Leaving a tab with unsaved edits asks first.
 */
export const ChatbotPage: React.FC = () => {
  const { botId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: bot, isLoading, isError, refetch } = useGetChatbotQuery(botId, { skip: !botId });
  // Only platform admins may change "Show typing" (it turns on read receipts too).
  const { data: list } = useGetChatbotsQuery();
  const isPlatformAdmin = Boolean(list?.canCreate);

  const tabItems = useMemo(() => {
    const open = bot?.stats.openUnanswered ?? 0;
    return TAB_ORDER.map(id => ({
      id,
      label: id === "unanswered" && open > 0 ? `${t.tabs[id]} (${open})` : t.tabs[id],
    }));
  }, [bot?.stats.openUnanswered]);

  const requested = searchParams.get("tab");
  // A section id as the tab (an older link, or the Overview checklist) opens that section of
  // Settings.
  const activeTab: ChatbotTabId = isSection(requested)
    ? "settings"
    : requested && TAB_ORDER.includes(requested as ChatbotTabId)
      ? (requested as ChatbotTabId)
      : "overview";
  const requestedSection = isSection(requested) ? requested : searchParams.get("section");
  const activeSection: ChatbotSettingsSectionId = isSection(requestedSection)
    ? requestedSection
    : "agent";
  // Tabs with unsaved edits report them here, so leaving one (or the page) asks first.
  const unsaved = useRef(new Set<string>());
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const reportUnsaved = useCallback((source: string, dirty: boolean) => {
    if (dirty) unsaved.current.add(source);
    else unsaved.current.delete(source);
    setHasUnsaved(unsaved.current.size > 0);
  }, []);
  useEffect(() => {
    if (!hasUnsaved) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  /** Open a tab or section. Edits handed to Preview travel with it, so that move doesn't ask. */
  const openTab = useCallback(
    (id: string) => {
      if (isSection(id)) setSearchParams({ tab: "settings", section: id });
      else setSearchParams(id === "overview" ? {} : { tab: id });
    },
    [setSearchParams],
  );
  const goToTab = useCallback(
    (id: string) => {
      const current = activeTab === "settings" ? activeSection : activeTab;
      if (id !== current && unsaved.current.size > 0) {
        if (!window.confirm(t.overview.unsavedLeave)) return;
        // Leaving without saving throws the edits away, including any handed to Preview.
        clearPreviewDraft(botId);
      }
      openTab(id);
    },
    [activeTab, activeSection, openTab, botId],
  );
  const sectionItems = useMemo(
    () => SECTION_ORDER.map(id => ({ id, label: t.settingsSections[id] })),
    [],
  );

  if (isLoading) return <SkeletonText paragraph lineCount={8} />;
  if (isError || !bot) {
    return <LoadError title={t.loadFailed} onRetry={() => void refetch()} />;
  }

  const canEdit = canDo(bot, ChatbotMemberRole.EDITOR);
  const canManage = canDo(bot, ChatbotMemberRole.OWNER);

  const renderSection = () => {
    switch (activeSection) {
      case "replies":
        return <TemplatesTab canEdit={canEdit} />;
      case "people":
        return <PeopleTab bot={bot} canEdit={canEdit} canManage={canManage} />;
      case "connectors":
        return <BotConnectorsTab bot={bot} canManage={canManage} />;
      case "botPage":
        return <BotPageTab bot={bot} canEdit={canEdit} />;
      case "lookAndFeel":
        return <LookAndFeelSection bot={bot} canEdit={canEdit} />;
      case "general":
        return (
          <ChatbotSettingsTab
            chatbotId={bot.id}
            chatbotName={bot.name}
            canEdit={canEdit}
            isPlatformAdmin={isPlatformAdmin}
          />
        );
      case "agent":
      default:
        return <AgentTab bot={bot} canEdit={canEdit} onTest={() => openTab("test")} />;
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case "persona":
        return <PersonaTab bot={bot} canEdit={canEdit} onTest={() => openTab("test")} />;
      case "knowledge":
        return <KnowledgeTab bot={bot} canEdit={canEdit} />;
      case "settings":
        return (
          <div className="flex flex-col gap-6">
            <Tabs
              items={sectionItems}
              activeId={activeSection}
              onChange={goToTab}
              showCount={false}
            />
            {renderSection()}
          </div>
        );
      case "test":
        return <ChatbotTestTab bot={bot} />;

      case "conversations":
        return <ConversationsTab bot={bot} onGo={goToTab} />;
      case "unanswered":
        return <UnansweredTab />;
      case "usage":
        return <UsageTab />;
      case "overview":
      default:
        return (
          <ChatbotOverviewTab bot={bot} canEdit={canEdit} canManage={canManage} onGo={goToTab} />
        );
    }
  };

  return (
    <div className="py-[2px] font-primary relative">
      <div className="flex flex-col gap-2 pb-6">
        <Link
          to={ROUTES.WHATSAPP_BOT}
          onClick={event => {
            if (unsaved.current.size === 0) return;
            if (window.confirm(t.overview.unsavedLeave)) clearPreviewDraft(botId);
            else event.preventDefault();
          }}
          className="text-sm text-typography-600 hover:underline w-fit"
        >
          ← {t.back}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-typography-900 font-secondary">{bot.name}</h1>
          <ChatbotStatusPill status={bot.status} />
          <span className="text-xs text-typography-500">{t.role[bot.myRole]}</span>
        </div>
        {bot.description && <p className="text-sm text-typography-600">{bot.description}</p>}
      </div>
      <Tabs items={tabItems} activeId={activeTab} onChange={goToTab} showCount={false} />
      <div className="pt-6">
        {/* Keyed by bot so moving between bots starts every tab fresh. */}
        <ChatbotContext.Provider value={bot.id} key={bot.id}>
          <UnsavedChangesContext.Provider value={reportUnsaved}>
            {renderTab()}
          </UnsavedChangesContext.Provider>
        </ChatbotContext.Provider>
      </div>
    </div>
  );
};

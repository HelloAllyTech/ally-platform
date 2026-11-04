import React, { useCallback, useMemo } from "react";

import { Link, useParams, useSearchParams } from "react-router-dom";

import { SkeletonText, Tabs } from "@ally-ui-mono/ui-shared";
import { useGetChatbotQuery } from "@api";
import { en, ROUTES } from "@constants";
import { Chatbot, ChatbotMemberRole } from "@types";

import { ChatbotContext } from "./chatbotContext";
import { ChatbotOverviewTab } from "./ChatbotOverviewTab";
import { ChatbotSettingsTab } from "./ChatbotSettingsTab";
import { ChatbotTestTab } from "./ChatbotTestTab";
import { BotConnectorsTab } from "./ConnectorsTab";
import { ConversationsTab } from "./ConversationsTab";
import { KnowledgeTab } from "./KnowledgeTab";
import { PeopleTab } from "./PeopleTab";
import { PersonaTab } from "./PersonaTab";
import { LoadError } from "./shared";
import { TemplatesTab } from "./TemplatesTab";
import { UnansweredTab } from "./UnansweredTab";
import { UsageTab } from "./UsageTab";
import { ChatbotStatusPill } from "./WhatsAppBot";

const t = en.whatsappBot.bots;

export type ChatbotTabId = keyof typeof t.tabs;

const TAB_ORDER: ChatbotTabId[] = [
  "overview",
  "persona",
  "knowledge",
  "replies",
  "people",
  "connectors",
  "settings",
  "test",
  "conversations",
  "unanswered",
  "usage",
];

const RANK: Record<ChatbotMemberRole, number> = {
  [ChatbotMemberRole.VIEWER]: 1,
  [ChatbotMemberRole.EDITOR]: 2,
  [ChatbotMemberRole.OWNER]: 3,
};

export const canDo = (bot: Pick<Chatbot, "myRole">, role: ChatbotMemberRole) =>
  RANK[bot.myRole] >= RANK[role];

/**
 * One chatbot: the same tabs for every bot, in the order you set one up. Everything inside reads
 * the bot from ChatbotContext, and every action is offered only to the roles the backend accepts
 * it from — a viewer sees the bot and can test it, an editor changes it, an owner also manages its
 * team and numbers.
 */
export const ChatbotPage: React.FC = () => {
  const { botId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: bot, isLoading, isError, refetch } = useGetChatbotQuery(botId, { skip: !botId });

  const tabItems = useMemo(() => {
    const open = bot?.stats.openUnanswered ?? 0;
    return TAB_ORDER.map(id => ({
      id,
      label: id === "unanswered" && open > 0 ? `${t.tabs[id]} (${open})` : t.tabs[id],
    }));
  }, [bot?.stats.openUnanswered]);

  const requested = searchParams.get("tab") as ChatbotTabId | null;
  const activeTab: ChatbotTabId =
    requested && TAB_ORDER.includes(requested) ? requested : "overview";
  const goToTab = useCallback(
    (id: string) => setSearchParams(id === "overview" ? {} : { tab: id }),
    [setSearchParams],
  );

  if (isLoading) return <SkeletonText paragraph lineCount={8} />;
  if (isError || !bot) {
    return <LoadError title={t.loadFailed} onRetry={() => void refetch()} />;
  }

  const canEdit = canDo(bot, ChatbotMemberRole.EDITOR);
  const canManage = canDo(bot, ChatbotMemberRole.OWNER);

  const renderTab = () => {
    switch (activeTab) {
      case "persona":
        return <PersonaTab bot={bot} canEdit={canEdit} onTest={() => goToTab("test")} />;
      case "knowledge":
        return <KnowledgeTab bot={bot} canEdit={canEdit} />;
      case "replies":
        return <TemplatesTab />;
      case "people":
        return <PeopleTab bot={bot} canEdit={canEdit} canManage={canManage} />;
      case "connectors":
        return <BotConnectorsTab bot={bot} canManage={canManage} />;
      case "settings":
        return <ChatbotSettingsTab chatbotId={bot.id} chatbotName={bot.name} canEdit={canEdit} />;
      case "test":
        return <ChatbotTestTab bot={bot} />;
      case "conversations":
        return <ConversationsTab />;
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
          {renderTab()}
        </ChatbotContext.Provider>
      </div>
    </div>
  );
};

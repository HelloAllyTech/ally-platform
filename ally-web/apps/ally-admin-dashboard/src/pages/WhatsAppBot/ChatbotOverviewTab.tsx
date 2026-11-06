import React from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useArchiveChatbotMutation, useSetChatbotStatusMutation } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en, ROUTES } from "@constants";
import {
  Chatbot,
  ChatbotAccessMode,
  ChatbotKnowledgeSource,
  ChatbotStatus,
  WaBusinessNumberStatus,
} from "@types";

import { Card, errorMessage, fill, missingPersonaFields, StatCard } from "./shared";

import type { ChatbotSettingsSectionId, ChatbotTabId } from "./ChatbotPage";

/** A tab, or a section of Settings (which opens Settings on it). */
type Destination = ChatbotTabId | ChatbotSettingsSectionId;

const t = en.whatsappBot.bots.overview;
const statusWord = en.whatsappBot.bots.status;

interface Step {
  label: string;
  done: boolean;
  tab: Destination;
  /** Why it isn't done yet, when that isn't obvious from the label. */
  hint?: string;
}

/** A channel that is set up and answering: not still waiting for Meta, and not in trouble. */
const isWorking = (connector: Chatbot["connectors"][number]) =>
  connector.summary?.status === WaBusinessNumberStatus.CONNECTED;

/**
 * What a bot still needs, as a short checklist read from the bot itself — so it is right on every
 * visit and disappears once the bot is ready — then the status controls and last-30-day activity.
 */
export const ChatbotOverviewTab: React.FC<{
  bot: Chatbot;
  canEdit: boolean;
  canManage: boolean;
  onGo: (tab: Destination) => void;
}> = ({ bot, canEdit, canManage, onGo }) => {
  const navigate = useNavigate();
  const [setStatus, { isLoading: isChanging }] = useSetChatbotStatusMutation();
  const [archive, { isLoading: isArchiving }] = useArchiveChatbotMutation();

  const missingInstructions = missingPersonaFields(bot.persona);
  const steps: Step[] = [
    {
      label: t.stepPersona,
      done: missingInstructions.length === 0,
      tab: "persona",
      hint: missingInstructions.length
        ? fill(en.whatsappBot.bots.persona.stillToFill, { fields: missingInstructions.join(", ") })
        : undefined,
    },
    {
      label: t.stepKnowledge,
      // Only documents it can answer from count: still indexing, failed or archived ones don't.
      done:
        bot.knowledgeSource === ChatbotKnowledgeSource.ORGANISATION || bot.readyDocumentCount > 0,
      tab: "knowledge",
      hint:
        bot.knowledgeSource !== ChatbotKnowledgeSource.ORGANISATION &&
        bot.documentCount > 0 &&
        bot.readyDocumentCount === 0
          ? t.knowledgePreparing
          : undefined,
    },
    {
      label: t.stepAccess,
      done: bot.accessMode !== ChatbotAccessMode.LISTED || bot.audienceCount > 0,
      tab: "people",
    },
    {
      label: t.stepTest,
      done: Boolean(bot.lastTestedAt) || bot.stats.messages > 0,
      tab: "test",
    },
    {
      label: t.stepConnector,
      // Only a channel that works counts: one still waiting for Meta or needing attention can't
      // reach anyone yet.
      done: bot.connectors.some(isWorking),
      tab: "connectors",
      hint:
        bot.connectors.length > 0 && !bot.connectors.some(isWorking)
          ? t.connectorNotWorking
          : undefined,
    },
  ];
  // Everything before publishing: Publish waits for all of it.
  const missingBeforePublish = steps.filter(step => !step.done).map(step => step.label);
  const canPublish = missingBeforePublish.length === 0;
  const isLive = bot.status === ChatbotStatus.LIVE;
  steps.push({ label: t.stepLive, done: isLive, tab: "overview" });
  const ready = steps.every(step => step.done);
  const missingList = missingBeforePublish.join(", ");
  const title = ready
    ? t.checklistDone
    : isLive
      ? fill(t.checklistLiveNotReady, { steps: missingList })
      : t.checklistTitle;

  const changeStatus = async (status: ChatbotStatus) => {
    try {
      await setStatus({ id: bot.id, status }).unwrap();
      toast.success(fill(t.statusChanged, { name: bot.name, status: statusWord[status] }));
    } catch (err) {
      toast.error(errorMessage(err, t.statusFailed));
    }
  };

  const handleArchive = async () => {
    if (!window.confirm(fill(t.archiveConfirm, { name: bot.name }))) return;
    try {
      await archive(bot.id).unwrap();
      toast.success(fill(t.archived, { name: bot.name }));
      navigate(ROUTES.WHATSAPP_BOT);
    } catch (err) {
      toast.error(errorMessage(err, t.statusFailed));
    }
  };

  const statusHint =
    bot.status === ChatbotStatus.LIVE
      ? t.liveHint
      : bot.status === ChatbotStatus.PAUSED
        ? t.pausedHint
        : t.draftHint;

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={title}
        subtitle={statusHint}
        action={
          canEdit && (
            <div className="flex flex-wrap gap-2">
              {bot.status !== ChatbotStatus.LIVE && (
                <Button
                  variant={ButtonVariant.PRIMARY}
                  onClick={() => void changeStatus(ChatbotStatus.LIVE)}
                  disabled={isChanging || !canPublish}
                >
                  {bot.status === ChatbotStatus.PAUSED ? t.resume : t.goLive}
                </Button>
              )}
              {bot.status === ChatbotStatus.LIVE && (
                <Button
                  variant={ButtonVariant.SECONDARY}
                  onClick={() => void changeStatus(ChatbotStatus.PAUSED)}
                  disabled={isChanging}
                >
                  {t.pause}
                </Button>
              )}
            </div>
          )
        }
      >
        {canEdit && !isLive && !canPublish && (
          <p className="text-sm text-typography-600" data-testid="publish-needs">
            {fill(t.publishNeeds, { steps: missingList })}
          </p>
        )}
        {!ready && (
          <ol className="flex flex-col divide-y divide-border-light">
            {steps.map((step, index) => (
              <li key={step.label} className="flex items-center gap-3 py-2.5">
                <span
                  className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs ${
                    step.done
                      ? "bg-success-400 text-white"
                      : "border border-border-light text-typography-600"
                  }`}
                  aria-hidden
                >
                  {step.done ? "✓" : index + 1}
                </span>
                <span className="flex-1 flex flex-col">
                  <span
                    className={`text-sm ${
                      step.done ? "text-typography-500 line-through" : "text-typography-900"
                    }`}
                  >
                    {step.label}
                  </span>
                  {!step.done && step.hint && (
                    <span className="text-xs text-typography-500">{step.hint}</span>
                  )}
                </span>
                {step.tab !== "overview" && (
                  <Button
                    variant={step.done ? ButtonVariant.TEXT : ButtonVariant.SECONDARY}
                    onClick={() => onGo(step.tab)}
                  >
                    {step.done ? t.view : t.open}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t.statMessages}
          value={bot.stats.messages}
          onClick={() => onGo("conversations")}
        />
        <StatCard label={t.statPeople} value={bot.stats.people} />
        <StatCard label={t.statAnswered} value={bot.stats.answered} onClick={() => onGo("usage")} />
        <StatCard
          label={t.statOpen}
          value={bot.stats.openUnanswered}
          onClick={() => onGo("unanswered")}
        />
      </div>

      {canManage && (
        <div>
          <Button
            variant={ButtonVariant.SECONDARY}
            onClick={() => void handleArchive()}
            disabled={isArchiving}
          >
            {t.archive}
          </Button>
        </div>
      )}
    </div>
  );
};

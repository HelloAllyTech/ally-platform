import React, { useEffect, useState } from "react";

import { useNavigate, useSearchParams } from "react-router-dom";

import { useGetArchivedChatbotsQuery, useGetChatbotsQuery, useGetMyPlanQuery } from "@api";
import { EmptyState } from "@components";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { en, ROUTES } from "@constants";
import { Chatbot, ChatbotStatus } from "@types";

import { isBlankDraft } from "./blank";
import { BUILDER_HOME, CREATE_MIN_WIDTH } from "./copy";
import { chatbotAccess } from "../AssistantHome/access";
import { HOME } from "../AssistantHome/copy";
import { TF1_COPY } from "../AssistantHome/copy/tf1";
import { day } from "../AssistantHome/dates";
import { MoreMenu } from "../AssistantHome/ui/Menu";
import { RemoveDialog } from "../AssistantHome/ui/RemoveDialog";
import { useRestoreAssistant } from "../AssistantHome/ui/useRestoreAssistant";
import { useMedia } from "../AssistantHome/userLists/useMedia";
import { COPY as ONBOARDING_COPY } from "../Onboarding/copy";
import { PlanAlertsBanner } from "../Plan/ui";
import { fill, LoadError } from "../WhatsAppBot/shared";

import "../AssistantHome/ui/scale.css";
import "../WhatsAppBot/list-page.css";

const t = en.whatsappBot.bots;
const c = BUILDER_HOME;

/** Where a card opens: an unfinished setup where it left off, else the chatbot's own page. */
export const botTarget = (bot: Chatbot): string =>
  bot.status === ChatbotStatus.DRAFT && bot.setupDraftId
    ? ROUTES.CHATBOT_NEW_SESSION(bot.setupDraftId)
    : ROUTES.CHATBOT_DETAIL.replace(":botId", bot.id);

/**
 * The builder's home (stage 2; replaces the old tabbed page): exactly two choices, Create a
 * chatbot and Open a chatbot. Open is the card grid, with "Show archived" folded in, and a count
 * of conversations waiting for a person on the cards of people who can respond, edit or own.
 * Inbox, Connectors, Defaults and Library are gone from here (Defaults, Library and Connectors
 * are the staff page, `ROUTES.ASSISTANT_DEFAULTS`).
 *
 * Gated like every page here: the `whatsapp_bot` sidebar entry, and open to anyone signed in on
 * the route (it lists only the chatbots they're on).
 */
export const BuilderHome: React.FC = () => {
  const { data, isLoading, isError, refetch } = useGetChatbotsQuery();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const showArchived = params.get("archived") === "1";
  const canCreate = Boolean(data?.canCreate);
  const roomy = useMedia(`(min-width: ${CREATE_MIN_WIDTH}px)`);
  const [narrowNote, setNarrowNote] = useState(false);
  // CR1: a limit at 80% or more this month shows as a banner above the chatbots.
  const { data: myPlan } = useGetMyPlanQuery();

  // Blank, untouched drafts are left out of the grid and the counts.
  const bots = (data?.chatbots ?? []).filter(bot => !isBlankDraft(bot));

  // On exactly one chatbot with no right to create another: open it straight (here, not in
  // DefaultRedirect, and with `replace`, so Back never bounces off this page into it again).
  const openStraight = !isLoading && !isError && !canCreate && !showArchived && bots.length === 1;
  useEffect(() => {
    if (openStraight) navigate(botTarget(bots[0]), { replace: true });
  }, [openStraight]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = () => {
    // Below the build screen's width nothing is created: no blank that can't be built.
    if (!roomy) {
      setNarrowNote(true);
      return;
    }
    navigate(ROUTES.CHATBOT_NEW);
  };

  const setArchived = (on: boolean) => setParams(on ? { archived: "1" } : {}, { replace: true });

  return (
    <div className="ally-v2 ally-list-page" data-testid="builder-home">
      <header className="ally-list-page__head">
        <div className="ally-list-page__title">
          <h1 className="ally-display">{c.title}</h1>
          <p className="ally-small">{c.subtitle}</p>
        </div>
      </header>
      <div className="ally-list-page__body">
        {myPlan?.alerts?.length ? (
          <div style={{ marginBottom: 16 }}>
            <PlanAlertsBanner alerts={myPlan.alerts} onOpen={() => navigate(ROUTES.MY_PLAN)} />
          </div>
        ) : null}

        {canCreate && (
          <section className="ally-card ally-list-page__choice" data-testid="choice-create">
            <div>
              <h2 className="ally-heading">{c.create.title}</h2>
              <p className="ally-small">{c.create.body}</p>
            </div>
            <Button variant={ButtonVariant.PRIMARY} type="button" onClick={create}>
              {c.create.button}
            </Button>
            {narrowNote && (
              <p className="ally-note ally-note--warn" role="status" data-testid="narrow-note">
                <strong>{c.narrow.title}.</strong> {c.narrow.body}
              </p>
            )}
          </section>
        )}

        <section aria-labelledby="open-heading" data-testid="choice-open">
          <div className="ally-list-page__open-head">
            <h2 className="ally-heading" id="open-heading">
              {c.open.title}
            </h2>
            <label className="ally-list-page__toggle ally-small">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={event => setArchived(event.target.checked)}
              />
              {c.showArchived}
            </label>
          </div>
          {isLoading || openStraight ? (
            <div className="ally-list-page__grid" aria-busy="true">
              {[0, 1, 2].map(n => (
                <span
                  key={n}
                  className="ally-card ally-list-page__card ally-list-page__card--skeleton"
                />
              ))}
            </div>
          ) : isError ? (
            <LoadError title={c.open.loadFailed} onRetry={() => void refetch()} />
          ) : (
            <>
              <ChatbotGrid bots={bots} canCreate={canCreate} onCreate={create} />
              {showArchived && <ArchivedGrid />}
            </>
          )}
        </section>
      </div>
    </div>
  );
};

/** Removed chatbots, most recent first. Opening one shows its page read-only. */
const ArchivedGrid: React.FC = () => {
  const { data, isLoading, isError, refetch } = useGetArchivedChatbotsQuery();
  const navigate = useNavigate();
  const { restore, restoring } = useRestoreAssistant();
  if (isLoading) return <div className="ally-list-page__grid" aria-busy="true" />;
  if (isError) return <LoadError title={c.archivedLoadFailed} onRetry={() => void refetch()} />;
  const bots = data?.chatbots ?? [];
  if (!bots.length) {
    return (
      <p className="ally-small" data-testid="archived-empty">
        {t.archived.empty}. {t.archived.emptyHint}
      </p>
    );
  }
  return (
    <div className="ally-list-page__grid" data-testid="archived-grid">
      {bots.map(bot => {
        const owner = chatbotAccess(bot).manage;
        return (
          <div
            key={bot.id}
            className={`ally-list-page__card-wrap${owner ? " ally-list-page__card-wrap--menu" : ""}`}
          >
            <button
              type="button"
              onClick={() => navigate(ROUTES.CHATBOT_DETAIL.replace(":botId", bot.id))}
              className="ally-card ally-list-page__card ally-list-page__card--archived"
            >
              <span className="ally-list-page__card-top">
                <span className="ally-list-page__name">
                  <span className="ally-list-page__bot">{bot.name}</span>
                </span>
                {bot.archivedAt && (
                  <span className="ally-badge ally-badge--muted ally-list-page__status">
                    {fill(t.archived.removed, { date: day(bot.archivedAt) })}
                  </span>
                )}
              </span>
              <span className="ally-list-page__stats ally-small">
                <span>{fill(t.cardMessages, { count: bot.stats.messages })}</span>
                <span>{fill(t.cardPeople, { count: bot.stats.people })}</span>
              </span>
            </button>
            {owner && (
              <div className="ally-list-page__menu">
                <MoreMenu
                  label={fill(HOME.overview.moreFor, { name: bot.name })}
                  items={[
                    {
                      label: HOME.archived.restore,
                      onSelect: () => {
                        if (!restoring) void restore(bot);
                      },
                    },
                  ]}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const ChatbotGrid: React.FC<{ bots: Chatbot[]; canCreate: boolean; onCreate: () => void }> = ({
  bots,
  canCreate,
  onCreate,
}) => {
  const navigate = useNavigate();
  // Owners can remove a chatbot they no longer want, finished or not, without opening it.
  const [removing, setRemoving] = useState<Chatbot | null>(null);
  if (!bots.length) {
    return (
      <EmptyState
        title={c.open.emptyTitle}
        subtitle={canCreate ? c.open.emptyCreate : c.open.emptyMember}
        actionLabel={c.create.button}
        onAction={onCreate}
        hideActionButton
      />
    );
  }
  return (
    <div className="ally-list-page__grid">
      {bots.map(bot => {
        const access = chatbotAccess(bot);
        const waiting = access.converse ? (bot.waitingForPerson ?? 0) : 0;
        return (
          <div
            key={bot.id}
            className={`ally-list-page__card-wrap${
              access.manage ? " ally-list-page__card-wrap--menu" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => navigate(botTarget(bot))}
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
              {waiting > 0 && (
                <span
                  className="ally-badge ally-list-page__waiting"
                  data-testid={`waiting-${bot.id}`}
                >
                  {fill(c.waiting, { count: waiting })}
                </span>
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
                <span className="ally-list-page__role">
                  {access.roles.map(role => t.role[role]).join(" · ")}
                </span>
              </span>
            </button>
            {/* TF1 F5: before go-live, the home (Knowledge, Lists, Settings) is one click away. */}
            {bot.status === ChatbotStatus.DRAFT && bot.setupDraftId && (
              <button
                type="button"
                className="ally-link ally-small"
                data-testid={`open-home-${bot.id}`}
                onClick={() => navigate(ROUTES.CHATBOT_DETAIL.replace(":botId", bot.id))}
              >
                {TF1_COPY.list.openHome}
              </button>
            )}
            {access.manage && (
              <div className="ally-list-page__menu">
                <MoreMenu
                  label={fill(HOME.overview.moreFor, { name: bot.name })}
                  items={[
                    { label: HOME.overview.remove, danger: true, onSelect: () => setRemoving(bot) },
                  ]}
                />
              </div>
            )}
          </div>
        );
      })}
      {removing && <RemoveDialog bot={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
};

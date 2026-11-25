import React, { useEffect, useLayoutEffect, useState } from "react";

import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useGetArchivedChatbotsQuery, useGetChatbotsQuery, useGetMyPlanQuery } from "@api";
import { Plus } from "@assets";
import { EmptyState } from "@components";
import { ASSISTANT_HEADER_SLOT_ID } from "@components/assistant-only/headerSlot";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { en, ROUTES } from "@constants";
import { Chatbot, ChatbotStatus } from "@types";

import { isBlankDraft } from "./blank";
import { BUILDER_HOME, CREATE_MIN_WIDTH } from "./copy";
import { EmptyChatbotsArt } from "./EmptyChatbotsArt";
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
 * The builder's home (stage 2; replaces the old tabbed page): the chatbots to open, in All /
 * Active / Archived views, and a count of conversations waiting for a person on the cards of
 * people who can respond, edit or own. The title is drawn in the shell's slim top bar
 * (`ASSISTANT_HEADER_SLOT_ID`), or inline when there is none; the Create new chatbot button sits at
 * the right end of the tab row.
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
  const view = viewFromParams(params);
  const canCreate = Boolean(data?.canCreate);
  const roomy = useMedia(`(min-width: ${CREATE_MIN_WIDTH}px)`);
  const [narrowNote, setNarrowNote] = useState(false);
  // CR1: a limit at 80% or more this month shows as a banner above the chatbots.
  const { data: myPlan } = useGetMyPlanQuery();

  // Blank, untouched drafts are left out of the grid and the counts.
  const bots = (data?.chatbots ?? []).filter(bot => !isBlankDraft(bot));

  // On exactly one chatbot with no right to create another: open it straight (here, not in
  // DefaultRedirect, and with `replace`, so Back never bounces off this page into it again).
  const openStraight =
    !isLoading && !isError && !canCreate && !params.has("view") && !params.has("archived")
      ? bots.length === 1
      : false;
  useEffect(() => {
    if (openStraight) navigate(botTarget(bots[0]), { replace: true });
  }, [openStraight]); // eslint-disable-line react-hooks/exhaustive-deps

  // The title lives in the shell's slim top bar when it has a slot for it.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHeaderSlot(document.getElementById(ASSISTANT_HEADER_SLOT_ID));
  }, []);

  const create = () => {
    // Below the build screen's width nothing is created: no blank that can't be built.
    if (!roomy) {
      setNarrowNote(true);
      return;
    }
    navigate(ROUTES.CHATBOT_NEW);
  };

  // The tabs are filtered views of one list: All (the default, so no param), Active, Archived.
  const setView = (next: BuilderView) =>
    setParams(next === "all" ? {} : { view: next }, { replace: true });
  // Archived chatbots are fetched only for the views that show them.
  const archived = useGetArchivedChatbotsQuery(undefined, { skip: view === "active" });
  const archivedBots = archived.data?.chatbots ?? [];

  const createButton = canCreate ? (
    <Button
      variant={ButtonVariant.PRIMARY}
      size="sm"
      className="shrink-0"
      type="button"
      onClick={create}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      {c.create.button}
    </Button>
  ) : null;

  return (
    <div className="ally-v2 ally-list-page" data-testid="builder-home">
      {headerSlot ? (
        createPortal(
          <>
            <h1 className="mr-auto min-w-0 truncate text-xl font-normal text-typography-900">
              {c.title}
            </h1>
          </>,
          headerSlot,
        )
      ) : (
        <header className="ally-list-page__head">
          <div className="ally-list-page__title">
            <h1 className="ally-display">{c.title}</h1>
          </div>
        </header>
      )}
      <div className="ally-list-page__body">
        {myPlan?.alerts?.length ? (
          <div style={{ marginBottom: 16 }}>
            <PlanAlertsBanner alerts={myPlan.alerts} onOpen={() => navigate(ROUTES.MY_PLAN)} />
          </div>
        ) : null}

        {canCreate && narrowNote && (
          <p
            className="ally-note ally-note--warn"
            role="status"
            data-testid="narrow-note"
            style={{ marginBottom: 16 }}
          >
            <strong>{c.narrow.title}.</strong> {c.narrow.body}
          </p>
        )}

        <section data-testid="choice-open">
          <div className="ally-list-page__tabbar">
            <ViewTabs view={view} onChange={setView} />
            {createButton}
          </div>
          <div role="tabpanel" id={VIEW_PANEL_ID} aria-labelledby={`${VIEW_TAB_ID}-${view}`}>
            <ChatbotList
              view={view}
              loading={
                view === "archived"
                  ? archived.isLoading
                  : isLoading || openStraight || (view === "all" && archived.isLoading)
              }
              error={view !== "archived" && isError}
              onRetry={() => void refetch()}
              bots={bots}
              archivedBots={archivedBots}
              archivedError={archived.isError}
              onRetryArchived={() => void archived.refetch()}
              canCreate={canCreate}
              onCreate={create}
            />
          </div>
        </section>
      </div>
    </div>
  );
};

type BuilderView = "all" | "active" | "archived";

const VIEWS: BuilderView[] = ["all", "active", "archived"];
const VIEW_TAB_ID = "builder-view-tab";
const VIEW_PANEL_ID = "builder-view-panel";

/** `?view=` picks the tab; the old `?archived=1` link (from a chatbot's page) lands on Archived. */
const viewFromParams = (params: URLSearchParams): BuilderView => {
  const view = params.get("view");
  if (view === "active" || view === "archived") return view;
  return params.get("archived") === "1" ? "archived" : "all";
};

/** All / Active / Archived: filtered views of the same chatbots, with arrow-key movement. */
const ViewTabs: React.FC<{ view: BuilderView; onChange: (view: BuilderView) => void }> = ({
  view,
  onChange,
}) => {
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = VIEWS[(VIEWS.indexOf(view) + step + VIEWS.length) % VIEWS.length];
    onChange(next);
    document.getElementById(`${VIEW_TAB_ID}-${next}`)?.focus();
  };
  return (
    <div
      className="ally-list-page__tabs"
      role="tablist"
      aria-label={c.tabs.label}
      onKeyDown={onKeyDown}
    >
      {VIEWS.map(id => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`${VIEW_TAB_ID}-${id}`}
          aria-selected={view === id}
          aria-controls={VIEW_PANEL_ID}
          tabIndex={view === id ? 0 : -1}
          className="ally-list-page__tab"
          onClick={() => onChange(id)}
        >
          {c.tabs[id]}
        </button>
      ))}
    </div>
  );
};

/** What the open tab shows. Archived chatbots follow the active ones on All. */
const ChatbotList: React.FC<{
  view: BuilderView;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  bots: Chatbot[];
  archivedBots: Chatbot[];
  archivedError: boolean;
  onRetryArchived: () => void;
  canCreate: boolean;
  onCreate: () => void;
}> = ({
  view,
  loading,
  error,
  onRetry,
  bots,
  archivedBots,
  archivedError,
  onRetryArchived,
  canCreate,
  onCreate,
}) => {
  if (loading) {
    return (
      <div className="ally-list-page__grid" aria-busy="true">
        {[0, 1, 2].map(n => (
          <span key={n} className="ally-card ally-list-page__card ally-list-page__card--skeleton" />
        ))}
      </div>
    );
  }
  if (error) return <LoadError title={c.open.loadFailed} onRetry={onRetry} />;

  const archivedPart = archivedError ? (
    <LoadError title={c.archivedLoadFailed} onRetry={onRetryArchived} />
  ) : (
    <ArchivedCards bots={archivedBots} />
  );

  if (view === "active") {
    return <ChatbotGrid bots={bots} canCreate={canCreate} onCreate={onCreate} />;
  }
  if (view === "archived") {
    return archivedBots.length || archivedError ? (
      archivedPart
    ) : (
      <p className="ally-small" data-testid="archived-empty">
        {t.archived.empty}. {t.archived.emptyHint}
      </p>
    );
  }
  // All: one empty state when there is nothing at all, else the active grid then the archived one.
  if (!bots.length && !archivedBots.length && !archivedError) {
    return <ChatbotGrid bots={bots} canCreate={canCreate} onCreate={onCreate} />;
  }
  return (
    <>
      {bots.length > 0 && <ChatbotGrid bots={bots} canCreate={canCreate} onCreate={onCreate} />}
      {(archivedBots.length > 0 || archivedError) && (
        <div style={bots.length ? { marginTop: 16 } : undefined}>{archivedPart}</div>
      )}
    </>
  );
};

/** Removed chatbots, most recent first. Opening one shows its page read-only. */
const ArchivedCards: React.FC<{ bots: Chatbot[] }> = ({ bots }) => {
  const navigate = useNavigate();
  const { restore, restoring } = useRestoreAssistant();
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
        illustration={<EmptyChatbotsArt />}
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
            }${
              bot.status === ChatbotStatus.DRAFT && bot.setupDraftId
                ? " ally-list-page__card-wrap--home-link"
                : ""
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
                className="ally-link ally-small ally-list-page__home-link"
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

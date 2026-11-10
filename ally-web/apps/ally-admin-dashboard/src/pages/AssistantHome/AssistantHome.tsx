import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Link, useParams, useSearchParams } from "react-router-dom";

import {
  useGetAssistantHomeQuery,
  useGetBotPageQuery,
  useGetChatbotQuery,
  useGetChatbotsQuery,
} from "@api";
import { Button, Toast } from "@components/v2";
import { ROUTES } from "@constants";
import { Chatbot, ChatbotMemberRole, ChatbotStatus } from "@types";

import { ChangePanel } from "./ChangePanel";
import { HOME } from "./copy";
import { EnginePanel } from "./EnginePanel";
import { SECTION_IDS, SectionId, sectionFromUrl } from "./sections";
import { COPY } from "../Onboarding/copy";
import { ChatbotContext } from "../WhatsAppBot/chatbotContext";
import { LoadError } from "../WhatsAppBot/shared";
import { UnsavedChangesContext } from "../WhatsAppBot/unsavedChanges";
import { CheckupSection } from "./sections/Checkup";
import { ConversationsSection } from "./sections/Conversations";
import { HowItWorksSection } from "./sections/HowItWorks";
import { KnowsSection } from "./sections/Knows";
import { OverviewSection } from "./sections/Overview";
import { PageSection } from "./sections/Page";
import { PersonalitySection } from "./sections/Personality";
import { SafetySection } from "./sections/Safety";
import { ShareSection } from "./sections/Share";
import { TryIt } from "./TryIt";
import { MoreMenu } from "./ui/Menu";
import { Sheet } from "./ui/Sheet";
import { HomeSaves, HomeSavesContext, SaveState } from "./useHomeField";
import "./home.css";
import "./ui/scale.css";

const RANK: Record<ChatbotMemberRole, number> = {
  [ChatbotMemberRole.VIEWER]: 1,
  [ChatbotMemberRole.EDITOR]: 2,
  [ChatbotMemberRole.OWNER]: 3,
};

const STATUS_LABEL: Record<ChatbotStatus, string> = {
  [ChatbotStatus.LIVE]: HOME.status.live,
  [ChatbotStatus.PAUSED]: HOME.status.paused,
  [ChatbotStatus.DRAFT]: HOME.status.draft,
};

type Panel = "try" | "engine" | "change" | null;

/**
 * Wide enough for the panel to sit beside the section (chunk 20d-2). Below it, Change and Try it
 * open over the page with a scrim, so three columns are never squeezed together; on a wide screen
 * an editor sees "Change your assistant" open on the right (screenshot 03).
 */
const WIDE = "(min-width: 1600px)";
const PHONE = "(max-width: 959px)";

const useMedia = (query: string): boolean => {
  const [matches, setMatches] = useState(() => Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return undefined;
    const on = () => setMatches(list.matches);
    on();
    list.addEventListener?.("change", on);
    return () => list.removeEventListener?.("change", on);
  }, [query]);
  return matches;
};

/**
 * The assistant home (chunk 20d, screenshot 03-assistant-home): everything about one assistant,
 * in the v2 design. A section list on the left (a row of chips on phones), the section in the
 * middle, and a panel on the right for Try it (20a-2 docks "Change your assistant" there). Every
 * field saves on its own with the version it started from; there are no Save buttons and no
 * unsaved-changes prompt. `?view=classic` keeps the old tabs for now (RouteLayout).
 */
export const AssistantHome: React.FC = () => {
  const { botId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: bot, isLoading, isError, refetch } = useGetChatbotQuery(botId, { skip: !botId });
  const home = useGetAssistantHomeQuery(botId, { skip: !botId });
  const { data: page } = useGetBotPageQuery(botId, { skip: !botId });
  const { data: list } = useGetChatbotsQuery();
  const isPlatformAdmin = Boolean(list?.canCreate);

  const fromUrl = sectionFromUrl(params);
  const section = fromUrl.section;
  const [panel, setPanel] = useState<Panel>(fromUrl.tryIt ? "try" : null);

  // The page's one save status and "Changed · Undo" toast, fed by every field.
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [undo, setUndo] = useState<{ run: () => void; key: number } | null>(null);
  const saves = useMemo<HomeSaves>(
    () => ({
      changed: run => setUndo({ run, key: Date.now() }),
      status: setSaveState,
    }),
    [],
  );

  const mainRef = useRef<HTMLDivElement>(null);
  const go = useCallback(
    (id: SectionId) => {
      setParams(id === "overview" ? {} : { section: id });
      // Focus moves to the new section's heading, for keyboard and screen reader users.
      requestAnimationFrame(() =>
        mainRef.current?.querySelector<HTMLElement>("[data-section-heading]")?.focus(),
      );
    },
    [setParams],
  );
  useEffect(() => {
    if (fromUrl.tryIt) setParams({});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On a phone the section chips scroll sideways: keep the open one in view.
  useEffect(() => {
    document
      .querySelector<HTMLElement>('.ally-home__nav-item[aria-current="page"]')
      ?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [section]);

  const wide = useMedia(WIDE);
  const phone = useMedia(PHONE);
  // The inbox is two columns of its own: the panel never docks beside it.
  const docked = wide && section !== "conversations";

  const editable =
    !!bot && !!home.data && RANK[bot.myRole] >= RANK[ChatbotMemberRole.EDITOR] && home.data.canEdit;
  const opened = useRef(false);
  useEffect(() => {
    if (!editable || opened.current) return;
    opened.current = true;
    if (window.matchMedia?.(WIDE).matches && section !== "conversations") {
      setPanel(p => p ?? "change");
    }
  }, [editable, section]);

  if (isLoading || home.isLoading) {
    // The header and section at their final size, so nothing moves when they arrive.
    return (
      <div className="ally-v2 ally-home ally-home--loading" aria-busy="true">
        <div className="ally-home__top ally-home__top--skeleton">
          <span className="ally-skeleton ally-skeleton--title" />
        </div>
        <div className="ally-home__body">
          <span className="ally-home__nav ally-skeleton ally-skeleton--nav" />
          <span className="ally-skeleton ally-skeleton--card" />
        </div>
      </div>
    );
  }
  if (isError || !bot || home.isError || !home.data) {
    return (
      <LoadError
        title={HOME.loadFailed}
        onRetry={() => {
          void refetch();
          void home.refetch();
        }}
      />
    );
  }

  const canEdit = RANK[bot.myRole] >= RANK[ChatbotMemberRole.EDITOR] && home.data.canEdit;
  const canManage = RANK[bot.myRole] >= RANK[ChatbotMemberRole.OWNER];
  const props = { bot, home: home.data, canEdit, canManage, go };

  const panelLabel =
    panel === "try"
      ? HOME.tryPanel.title
      : panel === "change"
        ? COPY.change.title
        : HOME.more.engine;

  const panelContent =
    panel === "change" ? (
      <ChangePanel
        botId={bot.id}
        canEdit={canEdit}
        onClose={() => setPanel(null)}
        onApplied={run => {
          void refetch();
          void home.refetch();
          saves.changed(run);
        }}
        onUndone={() => {
          void refetch();
          void home.refetch();
        }}
      />
    ) : panel === "try" ? (
      <TryIt bot={bot} page={page ?? null} onClose={() => setPanel(null)} />
    ) : panel === "engine" ? (
      <EnginePanel bot={bot} onClose={() => setPanel(null)} onTry={() => setPanel("try")} />
    ) : null;

  const render = (id: SectionId) => {
    switch (id) {
      case "knows":
        return <KnowsSection {...props} />;
      case "personality":
        return <PersonalitySection {...props} />;
      case "safety":
        return <SafetySection {...props} />;
      case "how":
        return <HowItWorksSection {...props} />;
      case "page":
        return <PageSection {...props} />;
      case "checkup":
        return <CheckupSection {...props} />;
      case "conversations":
        return <ConversationsSection {...props} />;
      case "share":
        return <ShareSection {...props} />;
      case "overview":
      default:
        return <OverviewSection {...props} page={page ?? null} />;
    }
  };

  return (
    <HomeSavesContext.Provider value={saves}>
      <ChatbotContext.Provider value={bot.id} key={bot.id}>
        {/* The embedded classic pieces report unsaved edits; the home saves as it goes. */}
        <UnsavedChangesContext.Provider value={noop}>
          <div className="ally-v2 ally-home" data-testid="assistant-home" data-section={section}>
            <header className="ally-home__top">
              <nav className="ally-home__crumb ally-small" aria-label="Breadcrumb">
                <Link to={ROUTES.WHATSAPP_BOT} className="ally-link">
                  {HOME.breadcrumb}
                </Link>
                <span aria-hidden="true"> / </span>
                <span aria-current="page">{bot.name}</span>
              </nav>
              <div className="ally-home__title-row">
                <h1 className="ally-home__title">{bot.name}</h1>
                <StatusPill bot={bot} />
                <span className="ally-small ally-home__saving" aria-live="polite">
                  {saveState === "saving"
                    ? HOME.saving.saving
                    : saveState === "failed"
                      ? HOME.saving.failed
                      : saveState === "saved"
                        ? HOME.saving.saved
                        : canEdit
                          ? HOME.saving.asYouGo
                          : ""}
                </span>
                <div className="ally-home__actions">
                  {canEdit && (
                    <Button
                      aria-pressed={panel === "change"}
                      onClick={() => setPanel(p => (p === "change" ? null : "change"))}
                    >
                      {COPY.change.title}
                    </Button>
                  )}
                  {page?.saved && (
                    <a
                      className="ally-btn ally-btn--secondary ally-home__open-page"
                      href={page.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {HOME.openPage}
                    </a>
                  )}
                  <Button
                    variant="primary"
                    aria-pressed={panel === "try"}
                    onClick={() => setPanel(p => (p === "try" ? null : "try"))}
                  >
                    {HOME.tryIt}
                  </Button>
                  <MoreMenu
                    label={HOME.more.more}
                    items={[
                      ...(page?.saved
                        ? [
                            {
                              label: HOME.openPage,
                              href: page.link,
                              external: true,
                              phoneOnly: true,
                            },
                          ]
                        : []),
                      // Ally staff only: how it answers, and the old tabs until CL1.
                      ...(isPlatformAdmin
                        ? [
                            { label: HOME.more.engine, onSelect: () => setPanel("engine") },
                            {
                              label: HOME.more.classic,
                              href: `${ROUTES.CHATBOT_DETAIL.replace(":botId", bot.id)}?view=classic`,
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
              </div>
            </header>

            <div className={`ally-home__body${panel ? " ally-home__body--panel" : ""}`}>
              <nav className="ally-home__nav" aria-label={bot.name}>
                <ul>
                  {SECTION_IDS.map(id => (
                    <li key={id}>
                      <button
                        type="button"
                        className="ally-home__nav-item"
                        aria-current={id === section ? "page" : undefined}
                        onClick={() => go(id)}
                      >
                        {HOME.sections[id]}
                        {id === "knows" && bot.stats.openUnanswered > 0 && (
                          <span className="ally-home__count">{bot.stats.openUnanswered}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>

              <main className="ally-home__main" ref={mainRef} data-testid={`section-${section}`}>
                {render(section)}
              </main>

              {panel && docked && (
                <aside className="ally-home__panel" aria-label={panelLabel}>
                  {panelContent}
                </aside>
              )}
            </div>

            {panel && !docked && (
              <Sheet
                label={panelLabel}
                onClose={() => setPanel(null)}
                side={phone ? "bottom" : "right"}
                testId="home-sheet"
              >
                {panelContent}
              </Sheet>
            )}

            {undo && (
              <Toast
                key={undo.key}
                message={COPY.look.changed}
                actionLabel={COPY.look.undo}
                onAction={undo.run}
                onDone={() => setUndo(null)}
              />
            )}
          </div>
        </UnsavedChangesContext.Provider>
      </ChatbotContext.Provider>
    </HomeSavesContext.Provider>
  );
};

const noop = () => undefined;

const StatusPill: React.FC<{ bot: Chatbot }> = ({ bot }) => (
  <span className={`ally-badge ally-home__status ally-home__status--${bot.status}`}>
    {STATUS_LABEL[bot.status]}
  </span>
);

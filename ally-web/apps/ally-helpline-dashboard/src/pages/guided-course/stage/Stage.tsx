import { FC, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import {
  AllyProse,
  LearnerBubble,
  MessageFeedbackProps,
  SystemCaption,
  ThinkingLine,
} from "./Messages";
import { SceneReceipt, SceneTitleCard } from "./SceneCards";
import { ItemCard } from "../cards/ItemCard";
import { CARD_KIND_RENDERER } from "../cards/registry";
import { ClosingRitualCard } from "../cards/special/ClosingRitualCard";
import { FinaleCard as FinaleRevealCard, finalePayloadOf } from "../cards/special/FinaleReveal";
import { activityOf, savedPracticeOf, SideQuestCard } from "../cards/special/SideQuestCard";
import {
  AccessDeniedCard,
  CourseInfoCard,
  FinaleCard,
  MicroActivityCard,
  ResourceCard,
  SignInCard,
} from "../cards/special/SpecialCards";
import { AllyPresence } from "../presence/AllyPresence";
import { capTone } from "../state/atmosphere";
import { firstCardInScene, visibleEntries } from "../state/sceneGrouping";
import { VisitorLanding } from "../visitor/VisitorLanding";

import type { GuideCard } from "../contract/wire";
import type { GuideJourney } from "../hooks/useGuideJourney";
import type { FeedEntry, MessageEntry } from "../state/guideFeedReducer";

export interface StageProps {
  journey: GuideJourney;
  trackId: string;
  courseTitle: string;
  compact: boolean;
  journeyUrl: string;
  onSignIn: () => void;
  onMyCourses: () => void;
  onFocusComposer: () => void;
  /** Opens the finale reveal for this card. */
  onOpenFinale?: (cardId: string) => void;
  /** Voice is on: Ally is heard, so the screen reader shouldn't say it again (plan §5.13). */
  muteAnnouncements?: boolean;
  /** Rendered after the last entry (the thinking line lives here). */
  footer?: ReactNode;
}

/** The conversation (plan §5.2 Stage): a 640–680 px reading column, organised into scenes. */
export const Stage: FC<StageProps> = ({
  journey,
  trackId,
  courseTitle,
  compact,
  journeyUrl,
  onSignIn,
  onMyCourses,
  onFocusComposer,
  onOpenFinale,
  footer,
  muteAnnouncements = false,
}) => {
  const { t } = useTranslation();
  const { feed, spine, atmosphere, cues, actions } = journey;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const entries = useMemo(
    () => visibleEntries(feed.entries, feed.scenes, expanded),
    [feed.entries, feed.scenes, expanded],
  );
  const streaming = feed.entries.some(e => e.kind === "message" && e.status === "streaming");
  const threadId = feed.threadId ?? "";

  // Follow the conversation while the learner is at the bottom; leave them be when they scroll up.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  const lastEntry = feed.entries[feed.entries.length - 1];
  const lastText = lastEntry?.kind === "message" ? lastEntry.text.length : 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [feed.entries.length, lastText, cues.thinking]);

  const toggleScene = useCallback((sceneId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  }, []);

  const skipIntro = useCallback(
    (sceneId: string) => {
      const cardId = firstCardInScene(feed.entries, sceneId);
      const el = cardId ? document.getElementById(`entry-${cardId}`) : null;
      el?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      (el?.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
    },
    [feed.entries],
  );

  const careMode = feed.mode === "CARE" || feed.mode === "CRISIS_FOLLOWUP";
  // "Ask about this" waits while Ally is replying; a visitor can't open items anyway.
  const askEnabled = journey.session.turn === "idle" && journey.identity !== "visitor";

  // Thumbs: a signed-in learner, on Ally's own (model) words, in a normal
  // moment. Never on fixed copy, and never in CARE or a crisis.
  const lastAllyId = useMemo(() => {
    for (let i = feed.entries.length - 1; i >= 0; i -= 1) {
      const entry = feed.entries[i];
      if (entry.kind === "message" && entry.role === "ally") return entry.id;
    }
    return null;
  }, [feed.entries]);
  const feedbackFor = (entry: MessageEntry): MessageFeedbackProps | null => {
    if (journey.identity !== "learner" || feed.mode !== "NORMAL") return null;
    if (entry.fixed || entry.status !== "final" || entry.seq === null) return null;
    const saved = journey.ratings[entry.id];
    return {
      rating: saved?.rating ?? null,
      commented: Boolean(saved?.comment),
      failed: saved?.status === "error",
      prominent: entry.id === lastAllyId,
      seeded: saved?.seeded ?? false,
      onRate: (rating, comment) => void actions.rateMessage(entry.id, rating, comment),
    };
  };

  const renderCard = (card: GuideCard): ReactNode => {
    const renderer = CARD_KIND_RENDERER[card.kind]?.renderer;
    const celebration = capTone(card.tone, atmosphere, feed.mode);
    switch (renderer) {
      case "item":
        return (
          <ItemCard
            card={card}
            active={feed.activeCardId === card.cardId}
            panelVisible={
              feed.activeCardId === card.cardId && journey.minimisedCardId !== card.cardId
            }
            compact={compact}
            celebration={celebration}
            onOpen={actions.openCard}
            trackId={trackId}
            threadId={threadId}
            onClaim={actions.claimCard}
            onClose={actions.closeCard}
            onLaunch={actions.launchCard}
            onAsk={actions.askAbout}
            askEnabled={askEnabled}
          />
        );
      case "micro_activity": {
        if (careMode) return null;
        const activity = activityOf(card);
        if (activity) {
          return (
            <SideQuestCard
              card={card}
              activity={activity}
              practice={journey.practice[card.cardId] ?? savedPracticeOf(card)}
              onAnswer={(cardId, request) => void actions.answerPractice(cardId, request)}
              onSkip={actions.dismissCard}
            />
          );
        }
        // A card from before the Coach: a prompt and choices that reply in the conversation.
        return (
          <MicroActivityCard
            card={card}
            onChoose={text => actions.submitTurn({ text, source: "practice" })}
            onTry={onFocusComposer}
            onSkip={() => actions.dismissCard(card.cardId)}
          />
        );
      }
      case "closing_ritual":
        return feed.mode === "CRISIS" ? null : (
          <ClosingRitualCard
            card={card}
            careMode={careMode}
            courseTitle={courseTitle}
            journeyUrl={journeyUrl}
            onSchedule={actions.scheduleAppointment}
          />
        );
      case "course_info":
        return <CourseInfoCard card={card} onOpen={() => actions.openCard(card.cardId, null)} />;
      case "resource":
        return (
          <ResourceCard language={feed.crisis?.language ?? "en"} lines={feed.crisis?.lines ?? []} />
        );
      case "sign_in":
        return <SignInCard onSignIn={onSignIn} />;
      case "access_denied":
        return (
          <AccessDeniedCard
            reason={((card.payload as { reason?: string } | undefined)?.reason ?? null) as never}
            onMyCourses={onMyCourses}
          />
        );
      case "finale":
        return finalePayloadOf(card) ? (
          <FinaleRevealCard card={card} onOpen={() => onOpenFinale?.(card.cardId)} />
        ) : (
          <FinaleCard card={card} />
        );
      case "chapter_title":
        return (
          <header className="mt-4 border-t border-[var(--g-line)] pt-5">
            <h2 className="font-primary text-2xl font-semibold text-[var(--g-ink)]">
              {card.title}
            </h2>
            {card.framing && (
              <p className="g-prose mt-1 text-[var(--g-ink-soft)]">{card.framing}</p>
            )}
          </header>
        );
      case "scene_receipt":
        return <SystemCaption>{card.title}</SystemCaption>;
      default:
        // Pinned (crisis) or unknown: not in the flow.
        return null;
    }
  };

  const renderEntry = (entry: FeedEntry): ReactNode => {
    switch (entry.kind) {
      case "message":
        if (entry.role === "learner") {
          return <LearnerBubble entry={entry} onRetry={actions.retryEcho} />;
        }
        if (entry.role === "system") return <SystemCaption>{entry.text}</SystemCaption>;
        return <AllyProse entry={entry} feedback={feedbackFor(entry)} />;
      case "card": {
        const card = feed.cards[entry.id];
        return card ? renderCard(card) : null;
      }
      case "scene": {
        const scene = feed.scenes[entry.sceneId];
        if (!scene) return null;
        const chapter = spine.chapters.find(c => c.id === scene.sectionId) ?? null;
        return (
          <SceneTitleCard
            scene={scene}
            chapter={chapter}
            chapterCount={spine.chapters.length}
            onSkipIntro={
              firstCardInScene(feed.entries, scene.sceneId)
                ? () => skipIntro(scene.sceneId)
                : undefined
            }
          />
        );
      }
      case "receipt": {
        const scene = feed.scenes[entry.sceneId];
        if (!scene) return null;
        const chapter = spine.chapters.find(c => c.id === scene.sectionId);
        return (
          <SceneReceipt
            scene={scene}
            chapterIndex={chapter ? chapter.index : null}
            expanded={expanded.has(scene.sceneId)}
            onToggle={() => toggleScene(scene.sceneId)}
          />
        );
      }
      case "milestone": {
        const tier = capTone(entry.milestone.tone, atmosphere, feed.mode);
        if (tier === "none") return null;
        return (
          <p
            className="g-rise text-center font-secondary text-lg italic text-[var(--g-ink)]"
            data-celebration={tier}
          >
            {entry.milestone.label}
          </p>
        );
      }
      case "notebook":
        return (
          <SystemCaption testId="notebook-saved">
            {entry.entry.kind === "noticing" ? `“${entry.entry.text}” · ` : ""}
            {t("guide.notebook.saved")}
          </SystemCaption>
        );
      default:
        return null;
    }
  };

  const showWelcome = feed.entries.length === 0;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto"
      data-testid="stage"
    >
      <div
        className="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-4 pb-6 pt-6 sm:px-6"
        style={{ rowGap: "calc(24px * var(--atm-space))" }}
      >
        {showWelcome &&
          (journey.identity === "visitor" ? (
            <VisitorLanding journey={journey} trackId={trackId} courseTitle={courseTitle} />
          ) : (
            <Welcome journey={journey} courseTitle={courseTitle} />
          ))}
        <div
          role="log"
          aria-label={t("guide.stage.label")}
          className="flex flex-col"
          style={{ rowGap: "calc(24px * var(--atm-space))" }}
        >
          {entries.map((entry, index) => {
            const node = renderEntry(entry);
            if (!node) return null;
            // Ally's framing line and the card it frames sit 12 px apart.
            const previous = entries[index - 1];
            const tight =
              entry.kind === "card" &&
              previous?.kind === "message" &&
              (previous as MessageEntry).role === "ally";
            return (
              <div key={entry.id} id={`entry-${entry.id}`} className={tight ? "-mt-3" : undefined}>
                {node}
              </div>
            );
          })}
          {cues.thinking && !streaming && feed.mode !== "CRISIS" && (
            <ThinkingLine
              caption={feed.toolActivity ?? feed.presence.caption}
              showCaption={cues.showCaption}
              slow={cues.slow}
            />
          )}
        </div>
        {footer}
        <Announcer entries={feed.entries} cards={feed.cards} muted={muteAnnouncements} />
      </div>
    </div>
  );
};

/**
 * The first screen of an empty thread: Ally, the disclosure, and entry chips
 * for a course without a story frame (plan D5). Enrolment happens on Start.
 */
const Welcome: FC<{ journey: GuideJourney; courseTitle: string }> = ({ journey, courseTitle }) => {
  const { t } = useTranslation();
  const { actions, session } = journey;
  const busy = session.turn !== "idle";
  const chip =
    "min-h-11 rounded-lg border border-[var(--g-line)] bg-[var(--g-card)] px-4 font-primary text-[15px] text-[var(--g-ink)] hover:border-[var(--g-ink-faint)] disabled:opacity-50";
  return (
    <section className="g-rise flex flex-col items-start gap-4 pt-4" data-testid="journey-welcome">
      <AllyPresence state={busy ? "thinking" : "idle"} size={64} />
      <div>
        <p className="g-label text-[var(--g-ally-label)]">{t("guide.header.disclosure")}</p>
        <h1 className="mt-1 font-primary text-[28px] font-semibold leading-[34px] text-[var(--g-ink)] [text-wrap:balance] md:text-[40px] md:leading-[46px]">
          {courseTitle}
        </h1>
        <p className="g-prose mt-2 text-[var(--g-ink-soft)]">{t("guide.welcome.line")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void actions.startCourse()}
          className={chip}
        >
          {t("guide.welcome.start")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            actions.submitTurn({
              text: t("guide.welcome.whatWillILearn"),
              source: "verb",
              verb: "whatWillILearn",
            })
          }
          className={chip}
        >
          {t("guide.welcome.whatWillILearn")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            actions.submitTurn({
              text: t("guide.welcome.howLong"),
              source: "verb",
              verb: "howLong",
            })
          }
          className={chip}
        >
          {t("guide.welcome.howLong")}
        </button>
      </div>
    </section>
  );
};

/**
 * Screen-reader announcements (plan §5.13): Ally's messages once they are
 * complete (not every delta) and cards when they arrive.
 */
const Announcer: FC<{
  entries: FeedEntry[];
  cards: Record<string, GuideCard>;
  muted: boolean;
}> = ({ entries, cards, muted }) => {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const announce: string[] = [];
    const known = seen.current;
    const next = new Set<string>();
    for (const entry of entries) {
      if (entry.kind === "message" && entry.role === "ally" && entry.status === "final") {
        next.add(entry.id);
        if (known && !known.has(entry.id)) announce.push(entry.text);
      } else if (entry.kind === "card") {
        const key = `${entry.id}:${cards[entry.id]?.state}`;
        next.add(key);
        const card = cards[entry.id];
        if (known && card && !known.has(key) && (card.state === "ready" || card.state === "done")) {
          announce.push(
            t(card.state === "done" ? "guide.announce.done" : "guide.announce.ready", {
              title: card.title,
            }),
          );
        }
      }
    }
    seen.current = next;
    if (announce.length && !muted) setMessage(announce.join(" "));
  }, [entries, cards, t, muted]);

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
};

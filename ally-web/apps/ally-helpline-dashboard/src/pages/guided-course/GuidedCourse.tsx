import { FC, ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";

import { LoginDialog } from "@components";
import { buildJourneyRoute, buildTrackItemRoute, buildTrackRoute, ROUTES } from "@constants";

import { ItemPlayerHost } from "./cards/ItemPlayerHost";
import { itemCardFor } from "./cards/registry";
import { CrisisCard } from "./cards/special/CrisisCard";
import { AccessDeniedCard, ResourceCard, SignInCard } from "./cards/special/SpecialCards";
import { safetyCopyFor } from "./copy/safetyCopy";
import { JourneyHeader } from "./header/JourneyHeader";
import { useGuideJourney } from "./hooks/useGuideJourney";
import { ShelfPanel, Sheet, TheatreHost } from "./layout/Panels";
import {
  DESKTOP_MIN,
  PHONE_MAX,
  shelfMode,
  SPINE_PINNED_MIN,
  useViewportWidth,
} from "./layout/useViewportWidth";
import { AllyPresence, OrbState } from "./presence/AllyPresence";
import { BreatheWithMe } from "./presence/BreatheWithMe";
import { JourneySpine, ProgressThread, SpineList } from "./spine/JourneySpine";
import {
  Composer,
  FailureNotice,
  NextStepDock,
  NowPlayingBar,
  ReplyVerbs,
} from "./stage/ComposerArea";
import { Stage } from "./stage/Stage";
import { dockVisible, ReplyVerb, replyVerbsFor } from "./state/atmosphere";
import { failureStateFor } from "./state/failureStates";
import { showOfflineNotice } from "./state/guidedSessionMachine";
import { lastAllyMessage } from "./state/guideFeedReducer";

import type { SpineNode } from "./state/spineModel";
import "./guided.css";

type SheetName = "spine" | "support" | "breathe" | null;

/** A full-screen page in the shell's colours, for the states before the journey opens. */
const StatePage: FC<{ children: ReactNode; testId: string }> = ({ children, testId }) => (
  <div
    className="guide-shell fixed inset-0 z-40 flex h-[100dvh] items-center justify-center overflow-y-auto p-4 font-primary"
    data-atmosphere="bright"
    data-testid={testId}
  >
    <div className="flex w-full max-w-[520px] flex-col items-start gap-4">{children}</div>
  </div>
);

/**
 * Ally's guided journey through one course (plan §5): the Course map (Spine),
 * the conversation (Stage), the side panel (Shelf) and full screen (Theatre),
 * under one atmosphere. Everything stateful lives in `useGuideJourney`.
 */
export const GuidedCourse: FC<{ trackId: string; fixture?: boolean }> = ({
  trackId,
  fixture = false,
}) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const journey = useGuideJourney(trackId, { fixture });
  const {
    feed,
    session,
    bootstrap,
    spine,
    atmosphere,
    cues,
    actions,
    guidance,
    helpRequested,
    minimisedCardId,
  } = journey;

  const width = useViewportWidth();
  const compact = width <= PHONE_MAX;
  const [spinePinned, setSpinePinned] = useState(width >= SPINE_PINNED_MIN);
  const [spineOpen, setSpineOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [composerFocus, setComposerFocus] = useState(0);

  const courseTitle = bootstrap?.course.title ?? "";
  const classicHref = spine.currentItemId
    ? buildTrackItemRoute(trackId, spine.currentItemId)
    : buildTrackRoute(trackId);
  const goClassic = useCallback(
    (source: "header" | "failure" | "card") => {
      actions.trackClassic(source);
      navigate(classicHref);
    },
    [actions, navigate, classicHref],
  );
  const goMyCourses = useCallback(() => navigate(`${ROUTES.LEARN}?tab=courses`), [navigate]);

  // ------------------------------------------------------------ active card
  const activeCard = feed.activeCardId ? feed.cards[feed.activeCardId] : null;
  const activeEntry = itemCardFor(activeCard?.trackItem?.type);
  const activePresentation = activeCard?.kind === "course_item" ? activeEntry?.presentation : null;
  const shelfCard = activePresentation === "shelf" ? activeCard : null;
  const theatreCard = activePresentation === "theatre" ? activeCard : null;
  const shelfWidth = activeEntry?.shelfWidth ?? "reading";
  const mode = shelfMode(width, shelfWidth, spinePinned && !compact);
  const minimised = Boolean(activeCard && minimisedCardId === activeCard.cardId);

  // ----------------------------------------------------------------- crisis
  const inCrisis = feed.mode === "CRISIS" || atmosphere === "still";
  useEffect(() => {
    if (inCrisis) setSheet(null);
  }, [inCrisis]);

  // ------------------------------------------------------------------ orb
  const orbState: OrbState = inCrisis
    ? "still"
    : feed.presence.state === "speaking" ||
        feed.entries.some(e => e.kind === "message" && e.status === "streaming")
      ? "speaking"
      : cues.thinking || feed.presence.state === "thinking"
        ? "thinking"
        : "idle";

  // ----------------------------------------------------------- composer zone
  const allyJustAnswered = Boolean(lastAllyMessage(feed));
  const verbs = replyVerbsFor({ mode: feed.mode, atmosphere, allyJustAnswered });
  const showDock =
    dockVisible({ atmosphere, mode: feed.mode, nextStep: feed.nextStep }) && journey.enrolled;
  const busy = session.turn !== "idle";

  const onVerb = useCallback(
    (verb: ReplyVerb) => {
      switch (verb) {
        case "breathe":
          setSheet("breathe");
          return;
        case "supportOptions":
          setSheet("support");
          return;
        case "talk":
        case "backToCourse":
          actions.submitTurn({ text: t(`guide.verbs.${verb}`), source: "care" });
          return;
        case "notNow":
          actions.submitTurn({
            text: t("guide.verbs.notNow"),
            intent: "not_now",
            source: "verb",
            verb,
          });
          return;
        default:
          actions.submitTurn({ text: t(`guide.verbs.${verb}`), source: "verb", verb });
      }
    },
    [actions, t],
  );

  const onContinue = useCallback(() => {
    const itemId = feed.nextStep?.itemId;
    const ready = Object.values(feed.cards).find(
      card =>
        card.kind === "course_item" && card.trackItem?.id === itemId && card.state === "ready",
    );
    if (ready) actions.openCard(ready.cardId, null);
    else actions.submitTurn({ text: "", intent: "continue", source: "dock" });
  }, [feed.nextStep, feed.cards, actions]);

  const onSpineSelect = useCallback(
    (node: SpineNode) => {
      setSheet(null);
      const card = Object.values(feed.cards).find(
        c => c.kind === "course_item" && c.trackItem?.id === node.id,
      );
      if (card) {
        const el = document.getElementById(`entry-${card.cardId}`);
        el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        (el?.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
        return;
      }
      if (node.state === "current") {
        actions.submitTurn({ text: "", intent: "continue", source: "dock" });
      } else if (node.state !== "done") {
        // A peek at what's ahead; Ally explains the order is the course's (plan §11 D-1).
        actions.submitTurn({
          text: "",
          intent: "locked_peek",
          anchor: { itemId: node.id },
          source: "verb",
          verb: "peek",
        });
      }
    },
    [feed.cards, actions],
  );

  const failure = feed.failure;
  const failureState = failure ? failureStateFor(failure.code) : null;
  const journeyUrl = useMemo(
    () =>
      typeof window === "undefined" ? "" : `${window.location.origin}${buildJourneyRoute(trackId)}`,
    [trackId],
  );

  // ------------------------------------------------------------ boot states
  if (session.boot === "loading") {
    return (
      <StatePage testId="journey-loading">
        <AllyPresence state="thinking" size={64} label={t("guide.boot.loading")} />
        <p className="g-caption">{t("guide.boot.loading")}</p>
      </StatePage>
    );
  }
  if (session.boot === "disabled") {
    // Kill switch, or the guide is off for this course: classic at the current item, never a dead end.
    return <Navigate to={classicHref} replace />;
  }
  if (session.boot === "unavailable") {
    return (
      <StatePage testId="journey-unavailable">
        <AllyPresence state="idle" size={48} />
        <p className="g-prose">{t("guide.failure.unavailable")}</p>
        <button
          type="button"
          onClick={goMyCourses}
          className="min-h-11 rounded-[10px] bg-[var(--g-action)] px-4 font-semibold text-[var(--g-on-action)]"
        >
          {t("guide.common.myCourses")}
        </button>
      </StatePage>
    );
  }
  if (session.boot === "denied") {
    return (
      <StatePage testId="journey-denied">
        <AccessDeniedCard reason={session.denialReason} onMyCourses={goMyCourses} />
      </StatePage>
    );
  }
  if (session.boot === "signed_out") {
    return (
      <StatePage testId="journey-signed-out">
        <AllyPresence state="idle" size={64} />
        <p className="g-label text-[var(--g-ally-label)]">{t("guide.header.disclosure")}</p>
        <SignInCard onSignIn={() => setLoginOpen(true)} />
        <LoginDialog
          isOpen={loginOpen}
          onClose={() => setLoginOpen(false)}
          onSuccess={() => {
            setLoginOpen(false);
            actions.retryBoot();
          }}
          requireTerms
        />
      </StatePage>
    );
  }
  if (session.boot === "error" || !bootstrap) {
    return (
      <StatePage testId="journey-error">
        <AllyPresence state="idle" size={48} />
        <p className="g-prose">{t("guide.failure.bootFailed")}</p>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={actions.retryBoot}
            className="min-h-11 rounded-[10px] bg-[var(--g-action)] px-4 font-semibold text-[var(--g-on-action)]"
          >
            {t("guide.common.retry")}
          </button>
          <a
            href={classicHref}
            className="text-sm text-[var(--g-ink-soft)] underline underline-offset-2"
          >
            {t("guide.common.openClassic")}
          </a>
        </div>
      </StatePage>
    );
  }

  const crisisLanguage = feed.crisis?.language ?? i18n.language;
  const showSupport = feed.supportPinned || feed.mode === "CARE" || feed.mode === "CRISIS_FOLLOWUP";
  // An item stays open in the Shelf or Theatre while the learner steps back to Ally.
  const nowPlaying =
    activeCard && activePresentation !== "inline" && minimised
      ? `${activeEntry ? t(activeEntry.typeWordKey) : ""} · ${activeCard.title}`
      : null;

  const playerHost = activeCard ? (
    <ItemPlayerHost
      key={activeCard.cardId}
      card={activeCard}
      trackId={trackId}
      threadId={feed.threadId ?? ""}
      onClaim={actions.claimCard}
      onClose={actions.closeCard}
      onLaunch={actions.launchCard}
    />
  ) : null;

  return (
    <div
      className="guide-shell fixed inset-0 z-40 flex h-[100dvh] flex-col font-primary"
      data-atmosphere={atmosphere}
      data-mode={feed.mode.toLowerCase()}
      data-testid="journey-shell"
    >
      <JourneyHeader
        courseTitle={courseTitle}
        orbState={orbState}
        guidance={guidance}
        onGuidanceChange={actions.setGuidance}
        showSupport={showSupport && !inCrisis}
        onSupport={() => setSheet("support")}
        onClassic={() => goClassic("header")}
        onExit={goMyCourses}
        quiet={inCrisis}
      />
      {compact && !inCrisis && <ProgressThread model={spine} onOpen={() => setSheet("spine")} />}

      <div className="relative flex min-h-0 flex-1">
        {!compact && !inCrisis && (
          <JourneySpine
            model={spine}
            expanded={spineOpen || spinePinned}
            pinned={spinePinned && width >= DESKTOP_MIN}
            onExpand={setSpineOpen}
            onTogglePin={() => setSpinePinned(p => !p)}
            onSelect={onSpineSelect}
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col" aria-label={t("guide.stage.label")}>
          {inCrisis && feed.crisis ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[680px] px-4 py-6 sm:px-6">
                <CrisisCard
                  message={feed.crisis.text}
                  language={crisisLanguage}
                  lines={feed.crisis.lines}
                  helpRequested={helpRequested}
                  onSafe={() => {
                    actions.chooseSafe();
                    actions.submitTurn({
                      text: safetyCopyFor(crisisLanguage).safeNow,
                      source: "crisis",
                    });
                  }}
                  onNeedHelp={actions.chooseNeedHelp}
                />
              </div>
            </div>
          ) : (
            <Stage
              journey={journey}
              trackId={trackId}
              courseTitle={courseTitle}
              compact={compact}
              journeyUrl={journeyUrl}
              onSignIn={() => setLoginOpen(true)}
              onMyCourses={goMyCourses}
              onFocusComposer={() => setComposerFocus(n => n + 1)}
            />
          )}

          <div className="shrink-0 border-t border-[var(--g-line)] bg-[var(--g-ground)]">
            <div className="mx-auto flex w-full max-w-[680px] flex-col gap-2 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 sm:px-6">
              {showOfflineNotice(session) && (
                <FailureNotice message={t("guide.failure.offline")} action={null} />
              )}
              {failure && failureState && !inCrisis && (
                <FailureNotice
                  message={t(failureState.copyKey)}
                  action={failureState.action}
                  onRetry={() => void actions.retryFailure()}
                  onClassic={() => goClassic("failure")}
                  onSignIn={() => setLoginOpen(true)}
                  onMyCourses={goMyCourses}
                  onDismiss={actions.dismissFailure}
                />
              )}
              {nowPlaying && activeCard && !inCrisis && (
                <NowPlayingBar label={nowPlaying} onBack={actions.restoreCard} />
              )}
              {showDock && feed.nextStep && !inCrisis && (
                <NextStepDock nextStep={feed.nextStep} disabled={busy} onContinue={onContinue} />
              )}
              {!inCrisis && <ReplyVerbs verbs={verbs} disabled={busy} onVerb={onVerb} />}
              <Composer
                sendBlocked={busy}
                focusToken={composerFocus}
                onSend={text => actions.submitTurn({ text, source: inCrisis ? "crisis" : "typed" })}
              />
            </div>
          </div>
        </main>

        {shelfCard && !inCrisis && (
          <ShelfPanel
            open
            minimised={minimised}
            mode={mode}
            sheet={compact}
            width={shelfWidth}
            title={shelfCard.title}
            typeWord={activeEntry ? t(activeEntry.typeWordKey) : ""}
            onBack={() =>
              mode === "push"
                ? actions.closeCard(shelfCard.cardId)
                : actions.minimiseCard(shelfCard.cardId)
            }
          >
            {playerHost}
          </ShelfPanel>
        )}
      </div>

      {theatreCard && !inCrisis && (
        <TheatreHost
          open
          minimised={minimised}
          title={theatreCard.title}
          onBack={() => actions.minimiseCard(theatreCard.cardId)}
        >
          {playerHost}
        </TheatreHost>
      )}

      <Sheet
        open={sheet === "spine"}
        title={t("guide.spine.label")}
        onClose={() => setSheet(null)}
        testId="spine-sheet"
      >
        <SpineList model={spine} onSelect={onSpineSelect} />
      </Sheet>
      <Sheet
        open={sheet === "support"}
        title={safetyCopyFor(crisisLanguage).supportChip}
        onClose={() => setSheet(null)}
        testId="support-sheet"
      >
        {feed.supportPinned ? (
          <CrisisCard language={crisisLanguage} lines={feed.crisis?.lines ?? []} reference />
        ) : (
          <ResourceCard language={crisisLanguage} lines={feed.crisis?.lines ?? []} />
        )}
      </Sheet>
      <Sheet
        open={sheet === "breathe"}
        title={t("guide.verbs.breathe")}
        onClose={() => setSheet(null)}
        testId="breathe-sheet"
      >
        <BreatheWithMe
          language={crisisLanguage}
          onClose={() => setSheet(null)}
          onReply={text => {
            setSheet(null);
            actions.submitTurn({ text, source: "care" });
          }}
        />
      </Sheet>

      <LoginDialog
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={() => {
          setLoginOpen(false);
          actions.retryBoot();
        }}
        requireTerms
      />
    </div>
  );
};

export default GuidedCourse;

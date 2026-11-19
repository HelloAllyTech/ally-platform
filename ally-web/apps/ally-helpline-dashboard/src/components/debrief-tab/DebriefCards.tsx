import { FC, ReactNode, useEffect, useMemo, useRef, useState } from "react";

import i18next, { type i18n } from "i18next";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { I18nextProvider, useTranslation } from "react-i18next";

import { LearnerDebriefView } from "@types";

import { BreathingPopup } from "./BreathingPopup";
import { Body, SeeMomentContext } from "./DebriefCardPrimitives";
import { DistressFirst } from "./DebriefDistressFirst";
import { DebriefExplainer } from "./DebriefExplainer";
import { ReadyCards, readableSections } from "./DebriefReadyCards";
import { ListenAllBar, ReadAloudContext, ReadAloudStatusLine } from "./ReadAloudControls";
import { useDebriefReadAloud } from "./useDebriefReadAloud";
import { useDebriefEvent, useWaitingEvents } from "./useReadToTheEnd";

import type { SupervisorView } from "./DebriefReadyCards";
export { readableSections } from "./DebriefReadyCards";

/** 'hi-IN' → 'hi'; anything unusable → undefined (inherit the page's lang). */
export const toLangAttribute = (language?: string | null): string | undefined => {
  const base = language?.trim().split(/[-_]/)[0]?.toLowerCase();
  return base ? base : undefined;
};

interface DebriefCardsProps {
  view: LearnerDebriefView;
  sessionId: string;
  /** Read-only for a supervisor on Roleplay Logs: no buttons, the learner's feedback shown. */
  supervisor?: SupervisorView;
  /** Ask Ally's thread and composer, under the reflective question. */
  replyThread?: ReactNode;
  /** "See this moment" on a quote: open the transcript at that turn. */
  onSeeQuote?: (quote: string) => void;
  /** "Try again" on a debrief that didn't load. */
  onRetry?: () => void;
  /** True while that retry is in flight. */
  retrying?: boolean;
}

/**
 * The Debrief agent's debrief, as structured cards. Only mounted when the
 * learner's organisation is switched on — `not_available` reaches here only
 * after an emergency stop (see `useLearnerDebrief`).
 *
 * No score, no percentage and no red anywhere: amber marks what needs
 * attention, and every status carries text plus an icon, never colour alone.
 */
/** Scripts that need more line height than Latin to stay legible (NFR-6: ≥ 1.6). */
const INDIC_LANGUAGES = new Set(["hi", "mr", "ta", "kn", "bn", "ml", "te", "gu", "pa", "or"]);

export const isIndicLanguage = (language?: string | null): boolean =>
  INDIC_LANGUAGES.has(toLangAttribute(language) ?? "");

/**
 * A separate i18next instance over the app's translations, fixed to the
 * debrief's language. Not `cloneInstance`: a clone shares the language
 * detector, and switching it would save the debrief's language as the app's.
 */
const debriefLanguageInstance = (app: i18n, lng: string): i18n => {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    fallbackLng: "en",
    resources: app.store.data,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  return instance;
};

/**
 * PRD §9: everything in the debrief follows the session's language, labels
 * included, whatever language the app is in. Languages without reviewed UI
 * copy fall back to English labels (i18next's fallback).
 */
export const DebriefCards: FC<DebriefCardsProps> = props => {
  const { i18n } = useTranslation();
  const lng = toLangAttribute(props.view.language);
  const debriefI18n = useMemo(
    () =>
      lng && i18n?.store && lng !== toLangAttribute(i18n.language)
        ? debriefLanguageInstance(i18n, lng)
        : null,
    [i18n, lng],
  );
  if (!debriefI18n) return <DebriefCardsInLanguage {...props} />;
  return (
    <I18nextProvider i18n={debriefI18n}>
      <DebriefCardsInLanguage {...props} />
    </I18nextProvider>
  );
};

const DebriefCardsInLanguage: FC<DebriefCardsProps> = ({
  view,
  sessionId,
  replyThread,
  supervisor,
  onSeeQuote,
  onRetry,
  retrying = false,
}) => {
  const { t } = useTranslation();
  const readAloud = useDebriefReadAloud(sessionId);
  // Read-aloud is the learner's: its audio links are theirs alone.
  const ready = view.state === "ready" && !!view.cards && !supervisor;
  // v9 §3.3 "abandoned before ready": waited on the working screen, left early.
  const reportWaiting = useDebriefEvent(sessionId, !supervisor);
  useWaitingEvents(view.state === "working", reportWaiting, !supervisor);
  const latestStep = view.steps?.length ? view.steps[view.steps.length - 1] : undefined;
  const progressLine = (): string => {
    const p = view.progress;
    if (!p) return latestStep || t("postSim.debriefCards.working.defaultStep");
    if (p.key === "guidance" && p.topic) {
      return t("postSim.debriefCards.working.steps.guidanceTopic", { topic: p.topic });
    }
    if (p.key === "revising") {
      return t("postSim.debriefCards.working.steps.revising", { round: p.round });
    }
    return t(`postSim.debriefCards.working.steps.${p.key}`);
  };

  // FR-27: the steps already done stay on the panel as quiet ticks, in the
  // order the run took them; the current one keeps the spinner.
  const currentLine = view.state === "working" ? progressLine() : null;
  const [doneLines, setDoneLines] = useState<string[]>([]);
  const lastLine = useRef<string | null>(null);
  useEffect(() => {
    if (!currentLine) return;
    const previous = lastLine.current;
    if (previous && previous !== currentLine) {
      setDoneLines(d => (d.includes(previous) ? d : [...d, previous]));
    }
    lastLine.current = currentLine;
  }, [currentLine]);

  // Plan §7.8: when a debrief the learner waited for is ready, focus moves to
  // the heading (never on a page that opened on a ready debrief).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasWorking = useRef(false);
  useEffect(() => {
    if (view.state === "working") wasWorking.current = true;
    else if (wasWorking.current && view.state === "ready" && view.cards) {
      wasWorking.current = false;
      headingRef.current?.focus();
    }
  }, [view.state, view.cards]);

  let content: ReactNode = null;
  if (view.state === "working") {
    content = (
      <div
        role="status"
        aria-live="polite"
        data-testid="debrief-working"
        className="flex items-center gap-3 rounded-lg border border-primary-100 bg-primary-50 p-4"
      >
        <Loader2
          aria-hidden="true"
          className="h-5 w-5 shrink-0 animate-spin text-primary-600 motion-reduce:animate-none"
        />
        <div className="flex flex-1 flex-col gap-1">
          <p className="font-primary text-sm font-semibold text-typography-900">
            {t("postSim.debriefCards.working.title")}
          </p>
          <ul className="flex flex-col gap-1" data-testid="debrief-working-steps">
            {doneLines
              .filter(line => line !== currentLine)
              .map(line => (
                <li
                  key={line}
                  className="flex items-center gap-1.5 font-primary text-sm text-typography-600"
                >
                  <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary-600" />
                  {line.replace(/…$/, "")}
                </li>
              ))}
            <li className="font-primary text-sm text-typography-700" aria-current="step">
              {currentLine}
            </li>
          </ul>
        </div>
      </div>
    );
  } else if (view.state === "taking_longer") {
    // Plan §7.5 / §10.3: a person is finishing it (no risk cue). Calm, not a
    // failure; the learner can check again rather than wait on a poll.
    content = (
      <div data-testid="debrief-taking-longer" className="flex flex-col gap-3">
        <div role="status" aria-live="polite">
          <Body>{t("postSim.debriefCards.takingLonger.body")}</Body>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-full border border-primary-200 bg-primary-50 px-4 font-primary text-sm font-semibold text-primary-600 transition-colors hover:bg-primary-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${retrying ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
            {retrying
              ? t("postSim.debriefCards.takingLonger.checking")
              : t("postSim.debriefCards.takingLonger.checkAgain")}
          </button>
        )}
      </div>
    );
  } else if (view.state === "on_its_way") {
    content = <Body>{t("postSim.debriefCards.onItsWay")}</Body>;
  } else if (view.state === "not_available") {
    // FR-46: the organisation's debriefs were stopped (only sent with `stopped`).
    content = (
      <div data-testid="debrief-not-available">
        <Body>{t("postSim.debriefCards.notAvailable")}</Body>
      </div>
    );
  } else if (view.state === "too_short") {
    content = <Body>{t("postSim.debriefCards.tooShort")}</Body>;
  } else if (view.state === "failed") {
    // PRD §6.12 "failed": the request itself failed. Amber, never red; the
    // debrief is safe, so say so and offer one way forward.
    content = (
      <div
        role="alert"
        data-testid="debrief-failed"
        className="flex flex-col gap-3 rounded-lg border-2 border-warning-300 bg-warning-50 p-4"
      >
        <h3 className="font-primary text-base font-semibold text-typography-900">
          {t("postSim.debriefCards.failed.title")}
        </h3>
        <Body>{t("postSim.debriefCards.failed.body")}</Body>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-md bg-primary-600 px-4 font-primary text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${retrying ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
            {retrying
              ? t("postSim.debriefCards.failed.retrying")
              : t("postSim.debriefCards.failed.retry")}
          </button>
        )}
      </div>
    );
  } else if (view.state === "ready" && view.cards) {
    const cards = (
      <ReadyCards
        cards={view.cards}
        view={view}
        sessionId={sessionId}
        replyThread={replyThread}
        supervisor={supervisor}
      />
    );
    content = view.distress ? <DistressFirst view={view}>{cards}</DistressFirst> : cards;
  }

  return (
    <SeeMomentContext.Provider value={onSeeQuote ?? null}>
      <ReadAloudContext.Provider value={ready ? readAloud : null}>
        <div className="flex w-full flex-col gap-2">
          <div className="flex w-full flex-col rounded-lg bg-gradient-to-br from-primary-500 to-primary-100 p-1">
            <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="font-primary text-lg font-semibold text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                {t("postSim.debriefCards.header")}
              </h2>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {ready && <ListenAllBar sections={readableSections(view)} />}
                <span className="rounded-full bg-white/90 px-2.5 py-0.5 font-primary text-xs font-medium text-typography-800">
                  {t("postSim.debriefCards.aiLabel")}
                </span>
                <DebriefExplainer />
              </div>
            </div>
            <div
              lang={toLangAttribute(view.language)}
              data-testid="debrief-cards"
              className={`flex flex-col gap-5 rounded-t-lg rounded-b-md bg-white p-4 sm:p-6 ${
                isIndicLanguage(view.language) ? "[&_*]:!leading-[1.7]" : ""
              }`}
            >
              <ReadAloudStatusLine />
              {/* FR-27: screen readers hear when the debrief is ready. */}
              <p className="sr-only" role="status" aria-live="polite">
                {view.state === "ready" && view.cards
                  ? t("postSim.debriefCards.ready.announce")
                  : ""}
              </p>
              {content}
            </div>
          </div>
          {/* Breathing is the learner's choice, never started for them: a link under the box, a popup on top of the page. */}
          {view.state === "working" && !supervisor && <BreathingPopup />}
        </div>
      </ReadAloudContext.Provider>
    </SeeMomentContext.Provider>
  );
};

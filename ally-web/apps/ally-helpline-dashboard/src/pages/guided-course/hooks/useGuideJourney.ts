import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  useEnrollGuideThreadMutation,
  useEnrollTrackMutation,
  useLazyGetGuideAvailabilityQuery,
  useLazyGetGuideBootstrapQuery,
  useLazyGetLearnTrackDetailQuery,
  useLazyGetTrackAccessQuery,
  useOpenGuideThreadMutation,
  usePostGuideCardEventMutation,
  usePutGuideAppointmentMutation,
  usePutGuidePrefsMutation,
  useSendGuideTurnMutation,
} from "@api";
import { LOCAL_STORAGE_KEYS } from "@constants";
import { ANALYTICS_EVENTS, ANALYTICS_PROPS } from "@constants/analyticsEvents";
import { useAnalytics } from "@hooks/useAnalytics";

import { bootJourney } from "./bootJourney";
import { useGuideEventStream } from "./useGuideEventStream";
import {
  DEFAULT_GUIDANCE,
  GUIDANCE_LEVELS,
  GuidanceLevel,
  JourneyBootstrap,
} from "../contract/bootstrap";
import { resolveAtmosphere } from "../state/atmosphere";
import { errorCodeOf, failureCodeFromHttp, statusOf } from "../state/failureStates";
import {
  guidedSessionMachine,
  initialSessionState,
  shouldQueue,
  turnCues,
} from "../state/guidedSessionMachine";
import {
  failureRetryText,
  guideFeedReducer,
  initialFeedState,
  MessageEntry,
  queuedEchoes,
} from "../state/guideFeedReducer";
import { buildSpineModel, chapterHasWarnings } from "../state/spineModel";

import type { AppointmentSlot } from "../cards/special/appointment";
import type { GuideAnchor, GuideCardEventRequest, GuideTurnRequest } from "../contract/wire";

const GUIDANCE_KEY = "allyGuideGuidance";

const readLocalGuidance = (): GuidanceLevel | null => {
  try {
    const value = localStorage.getItem(GUIDANCE_KEY);
    return GUIDANCE_LEVELS.includes(value as GuidanceLevel) ? (value as GuidanceLevel) : null;
  } catch {
    return null;
  }
};

let turnCounter = 0;
/** Idempotency key for a turn; a resend of the same message reuses it (plan §11 E-6). */
export const newClientTurnId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `c-${Date.now().toString(36)}-${(turnCounter += 1)}`;

export type TurnSource = "typed" | "verb" | "dock" | "practice" | "start" | "care" | "crisis";

export interface SubmitTurnInput {
  text: string;
  intent?: GuideTurnRequest["intent"];
  anchor?: GuideAnchor | null;
  source: TurnSource;
  verb?: string;
}

/** Sources that stay out of analytics (plan §6.3: nothing about distress leaves the thread). */
const PRIVATE_SOURCES: TurnSource[] = ["care", "crisis"];

export interface UseGuideJourneyOptions {
  /** Dev-only fixture transport: no sign-in needed. */
  fixture?: boolean;
}

/**
 * Everything the journey page needs, in one place: boot, the live stream,
 * the feed and session state, and the learner's actions. The page itself
 * only lays things out.
 */
export const useGuideJourney = (
  trackId: string,
  { fixture = false }: UseGuideJourneyOptions = {},
) => {
  const { i18n } = useTranslation();
  const { track } = useAnalytics();
  const [searchParams, setSearchParams] = useSearchParams();

  const [feed, dispatch] = useReducer(guideFeedReducer, initialFeedState);
  const [session, send] = useReducer(guidedSessionMachine, initialSessionState);
  const [bootstrap, setBootstrap] = useState<JourneyBootstrap | null>(null);
  const [guidance, setGuidanceState] = useState<GuidanceLevel>(
    readLocalGuidance() ?? DEFAULT_GUIDANCE,
  );
  const [bootAttempt, setBootAttempt] = useState(0);
  const [minimisedCardId, setMinimisedCardId] = useState<string | null>(null);
  const [helpRequested, setHelpRequested] = useState(false);
  const [enrolled, setEnrolled] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const feedRef = useRef(feed);
  feedRef.current = feed;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const lastRequest = useRef<SubmitTurnInput | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const [getBootstrap] = useLazyGetGuideBootstrapQuery();
  const [getAvailability] = useLazyGetGuideAvailabilityQuery();
  const [getAccess] = useLazyGetTrackAccessQuery();
  const [getDetail] = useLazyGetLearnTrackDetailQuery();
  const [openThread] = useOpenGuideThreadMutation();
  const [sendGuideTurn] = useSendGuideTurnMutation();
  const [postGuideCardEvent] = usePostGuideCardEventMutation();
  const [putGuidePrefs] = usePutGuidePrefsMutation();
  const [putGuideAppointment] = usePutGuideAppointmentMutation();
  const [enrollGuideThread] = useEnrollGuideThreadMutation();
  const [enrollTrack] = useEnrollTrackMutation();

  const threadId = bootstrap?.thread?.id ?? null;
  const courseProps = useMemo(() => ({ [ANALYTICS_PROPS.COURSE_ID]: trackId }), [trackId]);

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    let cancelled = false;
    void bootJourney(trackId, {
      isSignedIn: () => fixture || Boolean(localStorage.getItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN)),
      getBootstrap: id => getBootstrap({ trackId: id, languageCode: i18n.language }).unwrap(),
      getAvailability: id => getAvailability({ trackId: id }).unwrap(),
      getAccess: id => getAccess({ trackId: id }).unwrap(),
      getDetail: id => getDetail({ trackId: id, languageCode: i18n.language }).unwrap(),
      openThread: id => openThread({ trackId: id }).unwrap(),
      localGuidance: readLocalGuidance,
    }).then(outcome => {
      if (cancelled) return;
      switch (outcome.kind) {
        case "ready":
          setBootstrap(outcome.bootstrap);
          setGuidanceState(outcome.bootstrap.prefs.guidance);
          setEnrolled(outcome.bootstrap.access.enrolled);
          dispatch({ type: "hydrate", bootstrap: outcome.bootstrap });
          send({ type: "BOOT_OK" });
          break;
        case "denied":
          send({ type: "BOOT_DENIED", reason: outcome.reason });
          break;
        case "disabled":
          send({ type: "BOOT_DISABLED" });
          break;
        case "unavailable":
          send({ type: "BOOT_UNAVAILABLE" });
          break;
        case "signed_out":
          send({ type: "BOOT_SIGNED_OUT" });
          break;
        default:
          send({ type: "BOOT_ERROR" });
      }
    });
    return () => {
      cancelled = true;
    };
    // The RTK triggers are stable; the language is read once per boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, bootAttempt, fixture]);

  const retryBoot = useCallback(() => setBootAttempt(n => n + 1), []);

  // -------------------------------------------------------------- stream
  useGuideEventStream({
    threadId,
    enabled: session.boot === "ready",
    getLastSeq: () => feedRef.current.lastSeq,
    onEvent: event => {
      dispatch({ type: "event", event });
      send({ type: "SERVER_EVENT", event, at: Date.now() });
    },
    onStatus: status =>
      send({
        type:
          status === "connecting"
            ? "STREAM_CONNECTING"
            : status === "open"
              ? "STREAM_OPEN"
              : "STREAM_LOST",
      }),
    onFatal: reason =>
      send(
        reason === "disabled"
          ? { type: "BOOT_DISABLED" }
          : reason === "forbidden"
            ? { type: "BOOT_DENIED", reason: null }
            : { type: "BOOT_UNAVAILABLE" },
      ),
  });

  useEffect(() => {
    const online = () => send({ type: "NETWORK_ONLINE" });
    const offline = () => send({ type: "NETWORK_OFFLINE" });
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    if (typeof navigator !== "undefined" && navigator.onLine === false) offline();
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  // A clock for the thinking caption and the slow-turn line.
  const waiting = session.turn === "sending" || session.turn === "waiting";
  useEffect(() => {
    if (!waiting) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [waiting]);

  // ---------------------------------------------------------------- turns
  const postTurn = useCallback(
    async (input: SubmitTurnInput, clientTurnId: string) => {
      if (!threadId) return;
      send({ type: "TURN_SUBMITTED", at: Date.now() });
      try {
        const { turnId } = await sendGuideTurn({
          threadId,
          body: {
            clientTurnId,
            text: input.text,
            ...(input.intent ? { intent: input.intent } : {}),
            ...(input.anchor ? { anchor: input.anchor } : {}),
          },
        }).unwrap();
        dispatch({ type: "learner/accepted", clientTurnId, turnId });
      } catch (error) {
        send({ type: "TURN_REJECTED" });
        const status = statusOf(error);
        if (status === "FETCH_ERROR") {
          // Never reached the server: keep it and send on reconnect.
          dispatch({ type: "learner/status", clientTurnId, status: "queued" });
          return;
        }
        const code = failureCodeFromHttp(status, errorCodeOf(error));
        if (code === "guide_disabled") {
          send({ type: "BOOT_DISABLED" });
          return;
        }
        if (code === "no_access") {
          send({ type: "BOOT_DENIED", reason: null });
          return;
        }
        dispatch({ type: "learner/status", clientTurnId, status: "failed" });
        dispatch({
          type: "failure/local",
          failure: { code, message: "", turnId: null, clientTurnId },
        });
      }
    },
    [threadId, sendGuideTurn],
  );

  const submitTurn = useCallback(
    (input: SubmitTurnInput) => {
      if (!threadId) return;
      lastRequest.current = input;
      const clientTurnId = newClientTurnId();
      const queue = shouldQueue(sessionRef.current);
      if (input.text.trim()) {
        dispatch({
          type: "learner/echo",
          clientTurnId,
          text: input.text,
          anchor: input.anchor ?? null,
          status: queue ? "queued" : "sending",
        });
      }
      if (!PRIVATE_SOURCES.includes(input.source)) {
        track(ANALYTICS_EVENTS.GUIDED_MESSAGE_SENT, {
          ...courseProps,
          [ANALYTICS_PROPS.SOURCE]: input.source,
          ...(input.verb ? { [ANALYTICS_PROPS.GUIDED_VERB]: input.verb } : {}),
        });
      }
      if (queue) return;
      void postTurn(input, clientTurnId);
    },
    [threadId, postTurn, track, courseProps],
  );

  // Send what queued while offline, in order, under the ids they were given.
  useEffect(() => {
    if (session.connection !== "open") return;
    for (const echo of queuedEchoes(feedRef.current)) {
      if (!echo.clientTurnId) continue;
      dispatch({ type: "learner/status", clientTurnId: echo.clientTurnId, status: "sending" });
      void postTurn(
        { text: echo.text, anchor: echo.anchor ?? null, source: "typed" },
        echo.clientTurnId,
      );
    }
  }, [session.connection, postTurn]);

  const enrollIfNeeded = useCallback(async () => {
    if (enrolled || !threadId) return;
    try {
      await enrollGuideThread({ threadId, languageCode: i18n.language }).unwrap();
    } catch (error) {
      // An older backend has no guide enroll route; classic's is the same enrolment.
      if (statusOf(error) !== 404) throw error;
      await enrollTrack({ trackId, languageCode: i18n.language }).unwrap();
    }
    setEnrolled(true);
  }, [enrolled, threadId, enrollGuideThread, enrollTrack, trackId, i18n.language]);

  const startCourse = useCallback(async () => {
    try {
      await enrollIfNeeded();
    } catch {
      dispatch({
        type: "failure/local",
        failure: { code: "internal_error", message: "", turnId: null, clientTurnId: null },
      });
      return;
    }
    submitTurn({ text: "", intent: "start", source: "start" });
  }, [enrollIfNeeded, submitTurn]);

  const retryFailure = useCallback(async () => {
    const failure = feedRef.current.failure;
    const text = failureRetryText(feedRef.current);
    if (failure?.clientTurnId)
      dispatch({ type: "learner/discard", clientTurnId: failure.clientTurnId });
    dispatch({ type: "failure/dismiss" });
    if (failure?.code === "not_enrolled") {
      try {
        await enrollIfNeeded();
      } catch {
        return;
      }
    }
    const previous = lastRequest.current;
    if (text)
      submitTurn({ text, source: previous?.source ?? "typed", anchor: previous?.anchor ?? null });
    else if (previous) submitTurn(previous);
  }, [enrollIfNeeded, submitTurn]);

  const retryEcho = useCallback(
    (entry: MessageEntry) => {
      if (entry.clientTurnId)
        dispatch({ type: "learner/discard", clientTurnId: entry.clientTurnId });
      dispatch({ type: "failure/dismiss" });
      submitTurn({ text: entry.text, anchor: entry.anchor ?? null, source: "typed" });
    },
    [submitTurn],
  );

  // ---------------------------------------------------------------- cards
  const postCardEvent = useCallback(
    (cardId: string, body: GuideCardEventRequest) => {
      if (!threadId) return;
      // The verifier, not this call, decides what happened; a failed post is
      // recovered by the server's own progress events.
      void postGuideCardEvent({ threadId, cardId, body })
        .unwrap()
        .catch(() => undefined);
    },
    [threadId, postGuideCardEvent],
  );

  const openCard = useCallback(
    (cardId: string, focusFrom?: HTMLElement | null) => {
      const card = feedRef.current.cards[cardId];
      if (!card) return;
      returnFocus.current = focusFrom ?? null;
      setMinimisedCardId(null);
      dispatch({ type: "card/open", cardId });
      postCardEvent(cardId, { type: card.state === "done" ? "reopened" : "opened" });
      if (card.trackItem) {
        track(ANALYTICS_EVENTS.GUIDED_CARD_OPENED, {
          ...courseProps,
          [ANALYTICS_PROPS.GUIDED_ITEM_TYPE]: card.trackItem.type,
          [ANALYTICS_PROPS.GUIDED_PRESENTATION]: card.presentation,
        });
      }
    },
    [postCardEvent, track, courseProps],
  );

  const closeCard = useCallback(
    (cardId: string) => {
      setMinimisedCardId(null);
      dispatch({ type: "card/close", cardId });
      postCardEvent(cardId, { type: "closed" });
      // Focus returns to the card that opened the panel (plan §5.13).
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target?.isConnected) setTimeout(() => target.focus(), 0);
    },
    [postCardEvent],
  );

  /** Back to the conversation without closing the player (a phone sheet, the Theatre). */
  const minimiseCard = useCallback((cardId: string) => setMinimisedCardId(cardId), []);
  const restoreCard = useCallback(() => setMinimisedCardId(null), []);

  // The player's own mutation already recorded the completion; the claim asks
  // the server to verify it against progress and move the card (plan §10.4).
  const claimCard = useCallback(
    (cardId: string) => postCardEvent(cardId, { type: "completed_claim" }),
    [postCardEvent],
  );
  const launchCard = useCallback(
    (cardId: string) => postCardEvent(cardId, { type: "launched" }),
    [postCardEvent],
  );
  const dismissCard = useCallback(
    (cardId: string) => {
      dispatch({ type: "card/localState", cardId, state: "dismissed" });
      postCardEvent(cardId, { type: "dismissed" });
    },
    [postCardEvent],
  );

  // The server can ask for a card to open in the Shelf (`shelf.open`).
  useEffect(() => {
    const request = feed.shelfRequest;
    if (!request) return;
    dispatch({ type: "shelf/consumed" });
    if (feed.cards[request.cardId] && feed.mode !== "CRISIS") openCard(request.cardId, null);
  }, [feed.shelfRequest, feed.cards, feed.mode, openCard]);

  // Back from a roleplay or case the journey launched (`?returned=<cardId>`).
  const returnedHandled = useRef(false);
  useEffect(() => {
    if (session.boot !== "ready" || returnedHandled.current) return;
    returnedHandled.current = true;
    const returned = searchParams.get("returned");
    const outcome = searchParams.get("outcome") === "aborted" ? "aborted" : "completed";
    track(ANALYTICS_EVENTS.GUIDED_JOURNEY_OPENED, {
      ...courseProps,
      [ANALYTICS_PROPS.GUIDED_ENTRY]: returned
        ? "returned"
        : (bootstrap?.thread?.lastEventSeq ?? 0) === 0
          ? "new"
          : "returning",
    });
    if (!returned) return;
    postCardEvent(returned, { type: "returned", outcome });
    const next = new URLSearchParams(searchParams);
    next.delete("returned");
    next.delete("outcome");
    setSearchParams(next, { replace: true });
  }, [session.boot, searchParams, setSearchParams, postCardEvent, track, courseProps, bootstrap]);

  // ------------------------------------------------------------- settings
  const setGuidance = useCallback(
    (level: GuidanceLevel) => {
      setGuidanceState(level);
      try {
        localStorage.setItem(GUIDANCE_KEY, level);
      } catch {
        // Private mode: the server copy is enough.
      }
      void putGuidePrefs({ guidance: level })
        .unwrap()
        .catch(() => undefined);
      track(ANALYTICS_EVENTS.GUIDED_GUIDANCE_CHANGED, {
        ...courseProps,
        [ANALYTICS_PROPS.GUIDED_LEVEL]: level,
      });
    },
    [putGuidePrefs, track, courseProps],
  );

  const scheduleAppointment = useCallback(
    async (slot: AppointmentSlot, at: Date, timezone: string) => {
      if (!threadId) throw new Error("no thread");
      await putGuideAppointment({ threadId, body: { at: at.toISOString(), timezone } }).unwrap();
      track(ANALYTICS_EVENTS.GUIDED_APPOINTMENT_CHOSEN, {
        ...courseProps,
        [ANALYTICS_PROPS.GUIDED_SLOT]: slot,
      });
    },
    [threadId, putGuideAppointment, track, courseProps],
  );

  // ---------------------------------------------------------------- crisis
  const chooseSafe = useCallback(() => {
    dispatch({ type: "crisis/safe" });
    setHelpRequested(false);
  }, []);
  const chooseNeedHelp = useCallback(() => setHelpRequested(true), []);

  // ------------------------------------------------------------- analytics
  const failureCode = feed.failure?.code ?? null;
  useEffect(() => {
    if (failureCode) {
      track(ANALYTICS_EVENTS.GUIDED_FAILURE_SHOWN, {
        ...courseProps,
        [ANALYTICS_PROPS.GUIDED_FAILURE_CODE]: failureCode,
      });
    }
  }, [failureCode, track, courseProps]);

  const trackClassic = useCallback(
    (source: "header" | "failure" | "card") =>
      track(ANALYTICS_EVENTS.GUIDED_CLASSIC_VIEW_OPENED, {
        ...courseProps,
        [ANALYTICS_PROPS.SOURCE]: source,
      }),
    [track, courseProps],
  );

  // --------------------------------------------------------------- derived
  const spine = useMemo(
    () =>
      buildSpineModel({
        sections: bootstrap?.spine ?? [],
        progress: feed.progress,
        cards: feed.cards,
      }),
    [bootstrap?.spine, feed.progress, feed.cards],
  );
  const sceneSectionId =
    (feed.currentSceneId && feed.scenes[feed.currentSceneId]?.sectionId) || spine.currentChapterId;
  const atmosphere = resolveAtmosphere({
    mode: feed.mode,
    serverAtmosphere: feed.atmosphere,
    sceneHasWarnings: chapterHasWarnings(spine, sceneSectionId),
  });
  const cues = turnCues(session, now);

  return {
    feed,
    session,
    bootstrap,
    guidance,
    spine,
    atmosphere,
    cues,
    enrolled,
    minimisedCardId,
    helpRequested,
    actions: {
      retryBoot,
      submitTurn,
      startCourse,
      retryFailure,
      retryEcho,
      dismissFailure: () => dispatch({ type: "failure/dismiss" }),
      openCard,
      closeCard,
      minimiseCard,
      restoreCard,
      claimCard,
      launchCard,
      dismissCard,
      setGuidance,
      scheduleAppointment,
      chooseSafe,
      chooseNeedHelp,
      trackClassic,
    },
  };
};

export type GuideJourney = ReturnType<typeof useGuideJourney>;

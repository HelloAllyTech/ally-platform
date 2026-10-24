import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  useClaimGuideThreadMutation,
  useCreateGuideVisitorMutation,
  useEnrollGuideThreadMutation,
  useEnrollTrackMutation,
  useLazyGetGuideAvailabilityQuery,
  useLazyGetGuideBootstrapQuery,
  useLazyGetLearnTrackDetailQuery,
  useLazyGetTrackAccessQuery,
  useLazyGetVisitorBootstrapQuery,
  useOpenGuideThreadMutation,
  useOpenVisitorThreadMutation,
  usePostGuideCardEventMutation,
  usePutGuideAppointmentMutation,
  useAnswerGuideMicroActivityMutation,
  useRateGuideMessageMutation,
  usePutGuidePrefsMutation,
  useSendGuideTurnMutation,
  useSendVisitorTurnMutation,
  useSetTrackLanguageMutation,
} from "@api";
import { LOCAL_STORAGE_KEYS } from "@constants";
import { ANALYTICS_EVENTS, ANALYTICS_PROPS } from "@constants/analyticsEvents";
import { useAnalytics } from "@hooks/useAnalytics";
import type { TrackAccessDenialReason } from "@types";

import { bootJourney, ClaimOutcome, JourneyIdentity } from "./bootJourney";
import { useGuideEventStream } from "./useGuideEventStream";
import {
  DEFAULT_GUIDANCE,
  fromBootstrapWire,
  GUIDANCE_LEVELS,
  GuidanceLevel,
  JourneyBootstrap,
  JourneyThread,
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
  SIGN_IN_REFUSALS,
} from "../state/guideFeedReducer";
import { buildSpineModel, chapterHasWarnings, practiceItemIds } from "../state/spineModel";
import { dropVisitorToken, readVisitorToken, storeVisitorToken } from "../visitor/visitorToken";

import type { AppointmentSlot } from "../cards/special/appointment";
import type {
  GuideAnchor,
  GuideCardEventRequest,
  GuideMicroActivityRequest,
  GuideMicroActivityResult,
  GuideTurnRequest,
} from "../contract/wire";

const GUIDANCE_KEY = "allyGuideGuidance";
const SPINE_REFRESH_DELAY_MS = 400;
/** A visitor's first message waits this long at most for the new thread's stream. */
const STREAM_WAIT_MS = 4000;

const hasAccessToken = (): boolean => {
  try {
    return Boolean(localStorage.getItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN));
  } catch {
    return false;
  }
};

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

export type TurnSource =
  | "typed"
  | "verb"
  | "dock"
  | "practice"
  | "start"
  | "care"
  | "crisis"
  | "landing"
  | "ask"
  | "finale";

export interface SubmitTurnInput {
  text: string;
  intent?: GuideTurnRequest["intent"];
  anchor?: GuideAnchor | null;
  source: TurnSource;
  verb?: string;
}

/** Sources that stay out of analytics (plan §6.3: nothing about distress leaves the thread). */
const PRIVATE_SOURCES: TurnSource[] = ["care", "crisis"];

/** A side quest's answer on this page: kept here so a folded scene doesn't lose it. */
export interface PracticeState {
  status: "sending" | "done" | "error";
  request: GuideMicroActivityRequest;
  result?: GuideMicroActivityResult;
  /** The server's line for a refusal (e.g. "Choose an answer first."). */
  message?: string;
}

/** The learner's thumb on one of Ally's messages, on this page (the server keeps one per message). */
export interface MessageRating {
  rating: 1 | -1;
  comment?: string;
  status: "sending" | "saved" | "error";
}

export type SignInSource = "card" | "allowance" | "paused" | "item" | "voice" | "header";

export interface UseGuideJourneyOptions {
  /** Dev-only fixture transport: no sign-in needed. */
  fixture?: boolean;
  /** Dev-only: the fixture plays a signed-out visitor (anonymous chat). */
  fixtureVisitor?: boolean;
  /** A roleplay or case is about to leave for the full-screen simulation (voice lets go). */
  onLaunch?: () => void;
  /** Something only a signed-in learner can do was asked for (a course item, voice). */
  onSignInRequired?: (source: SignInSource) => void;
}

/**
 * Everything the journey page needs, in one place: boot, the live stream,
 * the feed and session state, and the learner's actions. The page itself
 * only lays things out.
 */
export const useGuideJourney = (
  trackId: string,
  {
    fixture = false,
    fixtureVisitor = false,
    onLaunch,
    onSignInRequired,
  }: UseGuideJourneyOptions = {},
) => {
  const { t, i18n } = useTranslation();
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
  const [practice, setPractice] = useState<Record<string, PracticeState>>({});
  const [ratings, setRatings] = useState<Record<string, MessageRating>>({});
  const [now, setNow] = useState(() => Date.now());
  // A signed-out visitor (M2) talks through the public routes with their own token.
  const [identity, setIdentity] = useState<JourneyIdentity>("learner");
  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  // Signing in: the visitor conversation is being claimed; sends wait (queued).
  const [claiming, setClaiming] = useState(false);
  // Signed in, but the course isn't theirs: the visitor conversation stays readable.
  const [claimDenied, setClaimDenied] = useState<{ reason: TrackAccessDenialReason | null } | null>(
    null,
  );

  const feedRef = useRef(feed);
  feedRef.current = feed;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const lastRequest = useRef<SubmitTurnInput | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const visitorTokenRef = useRef(visitorToken);
  visitorTokenRef.current = visitorToken;
  const claimingRef = useRef(claiming);
  claimingRef.current = claiming;
  const signInRequiredRef = useRef(onSignInRequired);
  signInRequiredRef.current = onSignInRequired;

  const [getBootstrap] = useLazyGetGuideBootstrapQuery();
  const [getAvailability] = useLazyGetGuideAvailabilityQuery();
  const [getAccess] = useLazyGetTrackAccessQuery();
  const [getDetail] = useLazyGetLearnTrackDetailQuery();
  const [openThread] = useOpenGuideThreadMutation();
  const [sendGuideTurn] = useSendGuideTurnMutation();
  const [postGuideCardEvent] = usePostGuideCardEventMutation();
  const [putGuidePrefs] = usePutGuidePrefsMutation();
  const [answerGuideMicroActivity] = useAnswerGuideMicroActivityMutation();
  const [rateGuideMessage] = useRateGuideMessageMutation();
  const [putGuideAppointment] = usePutGuideAppointmentMutation();
  const [enrollGuideThread] = useEnrollGuideThreadMutation();
  const [enrollTrack] = useEnrollTrackMutation();
  const [setTrackLanguage] = useSetTrackLanguageMutation();
  const [createGuideVisitor] = useCreateGuideVisitorMutation();
  const [getVisitorBootstrap] = useLazyGetVisitorBootstrapQuery();
  const [openVisitorThread] = useOpenVisitorThreadMutation();
  const [sendVisitorTurn] = useSendVisitorTurnMutation();
  const [claimGuideThread] = useClaimGuideThreadMutation();

  /** Enrols through the thread; an older backend without the route uses classic's (the same enrolment). */
  const enrollThread = useCallback(
    async (id: string) => {
      try {
        await enrollGuideThread({ threadId: id }).unwrap();
      } catch (error) {
        if (statusOf(error) !== 404) throw error;
        await enrollTrack({ trackId, languageCode: i18n.language }).unwrap();
      }
    },
    [enrollGuideThread, enrollTrack, trackId, i18n.language],
  );

  // After `spine.updated`, refetch bootstrap for the Spine's item states (the
  // event carries counts only). Coalesced: a burst of updates costs one fetch.
  const spineRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSpineRefresh = useCallback(() => {
    if (spineRefresh.current) clearTimeout(spineRefresh.current);
    spineRefresh.current = setTimeout(() => {
      spineRefresh.current = null;
      const token = identityRef.current === "visitor" ? visitorTokenRef.current : null;
      void (
        token
          ? getVisitorBootstrap({ trackId, token, languageCode: i18n.language })
          : getBootstrap({ trackId, languageCode: i18n.language })
      )
        .unwrap()
        .then(wire => {
          const fresh = fromBootstrapWire(trackId, wire);
          setBootstrap(prev =>
            prev
              ? { ...prev, spine: fresh.spine, nextStep: fresh.nextStep ?? prev.nextStep }
              : prev,
          );
        })
        .catch(() => undefined);
    }, SPINE_REFRESH_DELAY_MS);
  }, [getBootstrap, getVisitorBootstrap, trackId, i18n.language]);
  useEffect(
    () => () => {
      if (spineRefresh.current) clearTimeout(spineRefresh.current);
    },
    [],
  );

  // A visitor's thread arrives with their first message (`thread/opened`).
  const threadId = feed.threadId;
  const courseProps = useMemo(() => ({ [ANALYTICS_PROPS.COURSE_ID]: trackId }), [trackId]);

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    let cancelled = false;
    void bootJourney(trackId, {
      isSignedIn: () => (fixture && !fixtureVisitor) || hasAccessToken(),
      getBootstrap: id => getBootstrap({ trackId: id, languageCode: i18n.language }).unwrap(),
      getAvailability: id => getAvailability({ trackId: id }).unwrap(),
      getAccess: id => getAccess({ trackId: id }).unwrap(),
      getDetail: id => getDetail({ trackId: id, languageCode: i18n.language }).unwrap(),
      openThread: id => openThread({ trackId: id }).unwrap(),
      enroll: id => enrollThread(id),
      localGuidance: readLocalGuidance,
      visitor: {
        ensureToken: async () => {
          const stored = readVisitorToken();
          if (stored) return stored;
          const { token } = await createGuideVisitor().unwrap();
          storeVisitorToken(token);
          return token;
        },
        dropToken: dropVisitorToken,
        getBootstrap: (id, token) =>
          getVisitorBootstrap({ trackId: id, token, languageCode: i18n.language }).unwrap(),
      },
      claim: {
        pendingToken: readVisitorToken,
        claimThread: (id, token) => claimGuideThread({ trackId: id, visitorToken: token }).unwrap(),
        dropToken: dropVisitorToken,
      },
    }).then(outcome => {
      if (cancelled) return;
      const wasClaiming = claimingRef.current;
      setClaiming(false);
      switch (outcome.kind) {
        case "ready":
          setIdentity(outcome.identity);
          setVisitorToken(outcome.visitorToken ?? null);
          setClaimDenied(null);
          setBootstrap(outcome.bootstrap);
          setGuidanceState(
            outcome.identity === "visitor"
              ? (readLocalGuidance() ?? outcome.bootstrap.prefs.guidance)
              : outcome.bootstrap.prefs.guidance,
          );
          setEnrolled(outcome.bootstrap.access.enrolled);
          // After signing in, what was typed meanwhile is still waiting to go.
          dispatch({ type: "hydrate", bootstrap: outcome.bootstrap, keepQueued: wasClaiming });
          if (outcome.claim) trackClaim(outcome.claim);
          send({ type: "BOOT_OK" });
          break;
        case "denied":
          if (outcome.claimRefused && wasClaiming && identityRef.current === "visitor") {
            // The course isn't theirs: the conversation so far stays as it was (plan §11 A-2).
            setClaimDenied({ reason: outcome.reason });
            break;
          }
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
  }, [trackId, bootAttempt, fixture, fixtureVisitor]);

  const retryBoot = useCallback(() => setBootAttempt(n => n + 1), []);

  /** The visitor token was refused (expired, or already claimed): start a new visit. */
  const visitorRefused = useCallback(() => {
    dropVisitorToken();
    setVisitorToken(null);
    retryBoot();
  }, [retryBoot]);

  /**
   * Back from the LoginDialog. A visitor's conversation is claimed on the way
   * in (bootJourney sends the token once); until the new bootstrap lands the
   * feed stays as it is and anything typed waits in the queue.
   */
  const signedIn = useCallback(() => {
    if (identityRef.current === "visitor" && readVisitorToken()) {
      claimingRef.current = true;
      setClaiming(true);
    }
    retryBoot();
  }, [retryBoot]);

  // -------------------------------------------------------------- stream
  useGuideEventStream({
    threadId,
    enabled: session.boot === "ready" && !claiming,
    visitorToken: identity === "visitor" ? visitorToken : null,
    getLastSeq: () => feedRef.current.lastSeq,
    onEvent: event => {
      dispatch({ type: "event", event });
      send({ type: "SERVER_EVENT", event, at: Date.now() });
      // The event carries counts only; the Spine's item states come from bootstrap.
      if (event.type === "spine.updated") scheduleSpineRefresh();
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
    onFatal: reason => {
      if (reason === "visitor_invalid") {
        visitorRefused();
        return;
      }
      send(
        reason === "disabled"
          ? { type: "BOOT_DISABLED" }
          : reason === "forbidden"
            ? { type: "BOOT_DENIED", reason: null }
            : { type: "BOOT_UNAVAILABLE" },
      );
    },
  });

  // A visitor's first message waits for their new thread's stream, so the
  // reply (or a refusal, which only streams) isn't missed.
  const openWaiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    if (session.connection !== "open") return;
    const waiters = openWaiters.current;
    openWaiters.current = [];
    waiters.forEach(resolve => resolve());
  }, [session.connection]);
  const streamOpen = useCallback(
    () =>
      new Promise<void>(resolve => {
        openWaiters.current.push(resolve);
        setTimeout(resolve, STREAM_WAIT_MS);
      }),
    [],
  );

  const visitorThread = useRef<Promise<string> | null>(null);
  const ensureVisitorThread = useCallback(async (): Promise<string | null> => {
    if (feedRef.current.threadId) return feedRef.current.threadId;
    const token = visitorTokenRef.current;
    if (!token) return null;
    visitorThread.current ??= (async () => {
      const opened = await openVisitorThread({ trackId, token }).unwrap();
      const thread: JourneyThread = {
        id: opened.id,
        mode: opened.mode,
        atmosphere: opened.atmosphere,
        lastEventSeq: opened.lastEventSeq,
      };
      dispatch({ type: "thread/opened", thread });
      setBootstrap(prev => (prev ? { ...prev, thread } : prev));
      await streamOpen();
      return thread.id;
    })().finally(() => {
      visitorThread.current = null;
    });
    return visitorThread.current;
  }, [openVisitorThread, trackId, streamOpen]);

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
      const visitor = identityRef.current === "visitor";
      if (!feedRef.current.threadId && !visitor) return;
      send({ type: "TURN_SUBMITTED", at: Date.now() });
      try {
        const id = visitor ? await ensureVisitorThread() : feedRef.current.threadId;
        if (!id) throw new Error("no thread");
        const body: GuideTurnRequest = {
          clientTurnId,
          text: input.text,
          ...(input.intent ? { intent: input.intent } : {}),
          ...(input.anchor ? { anchor: input.anchor } : {}),
        };
        const { turnId } = visitor
          ? await sendVisitorTurn({
              threadId: id,
              token: visitorTokenRef.current ?? "",
              body,
            }).unwrap()
          : await sendGuideTurn({ threadId: id, body }).unwrap();
        dispatch({ type: "learner/accepted", clientTurnId, turnId });
      } catch (error) {
        send({ type: "TURN_REJECTED" });
        if (visitor && errorCodeOf(error) === "GUIDE_VISITOR_INVALID") {
          visitorRefused();
          return;
        }
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
    [ensureVisitorThread, sendGuideTurn, sendVisitorTurn, visitorRefused],
  );

  /** A visitor out of messages (or paused) is asked to sign in instead of sending. */
  const visitorBlocked = (): boolean =>
    identityRef.current === "visitor" &&
    (feedRef.current.allowance?.remaining === 0 ||
      (SIGN_IN_REFUSALS as readonly string[]).includes(feedRef.current.failure?.code ?? ""));

  const submitTurn = useCallback(
    (input: SubmitTurnInput) => {
      if (!threadId && identityRef.current !== "visitor") return;
      if (visitorBlocked()) {
        signInRequiredRef.current?.("allowance");
        return;
      }
      lastRequest.current = input;
      const clientTurnId = newClientTurnId();
      const queue = shouldQueue(sessionRef.current) || claimingRef.current;
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
    if (session.connection !== "open" || claiming) return;
    for (const echo of queuedEchoes(feedRef.current)) {
      if (!echo.clientTurnId) continue;
      dispatch({ type: "learner/status", clientTurnId: echo.clientTurnId, status: "sending" });
      void postTurn(
        { text: echo.text, anchor: echo.anchor ?? null, source: "typed" },
        echo.clientTurnId,
      );
    }
  }, [session.connection, postTurn, claiming]);

  const enrollIfNeeded = useCallback(async () => {
    if (enrolled || !threadId || identityRef.current === "visitor") return;
    await enrollThread(threadId);
    setEnrolled(true);
  }, [enrolled, threadId, enrollThread]);

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
      // Card events are a learner's; a visitor's cards only lead to sign-in.
      if (!threadId || identityRef.current === "visitor") return;
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
      // The players need a signed-in learner; a visitor signs in first.
      if (identityRef.current === "visitor" && card.kind === "course_item") {
        signInRequiredRef.current?.("item");
        return;
      }
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
  const onLaunchRef = useRef(onLaunch);
  onLaunchRef.current = onLaunch;
  const launchCard = useCallback(
    (cardId: string) => {
      onLaunchRef.current?.();
      postCardEvent(cardId, { type: "launched" });
    },
    [postCardEvent],
  );
  const dismissCard = useCallback(
    (cardId: string) => {
      dispatch({ type: "card/localState", cardId, state: "dismissed" });
      postCardEvent(cardId, { type: "dismissed" });
    },
    [postCardEvent],
  );

  /**
   * Thumbs on one of Ally's messages; a comment can follow a thumbs-down.
   * Sending again replaces the last (one per message). Analytics gets the
   * direction only, never the comment.
   */
  const rateMessage = useCallback(
    async (messageId: string, rating: 1 | -1, comment?: string) => {
      if (identityRef.current === "visitor") return;
      setRatings(prev => ({ ...prev, [messageId]: { rating, comment, status: "sending" } }));
      try {
        await rateGuideMessage({
          messageId,
          body: { rating, ...(comment?.trim() ? { comment: comment.trim() } : {}) },
        }).unwrap();
        setRatings(prev => ({ ...prev, [messageId]: { rating, comment, status: "saved" } }));
        if (!comment) {
          track(ANALYTICS_EVENTS.GUIDED_MESSAGE_RATED, {
            ...courseProps,
            [ANALYTICS_PROPS.GUIDED_RATING]: rating === 1 ? "up" : "down",
          });
        }
      } catch {
        setRatings(prev => ({ ...prev, [messageId]: { rating, comment, status: "error" } }));
      }
    },
    [rateGuideMessage, track, courseProps],
  );

  /**
   * "Ask about this" (plan §5.8): a turn in the learner's words with the item
   * and the quote or moment attached. Ally answers in the conversation.
   */
  const askAbout = useCallback(
    (_cardId: string, anchor: GuideAnchor, kind: "article" | "video" | "quiz") => {
      submitTurn({ text: t(`guide.ask.${kind}Turn`), anchor, source: "ask", verb: kind });
    },
    [submitTurn, t],
  );

  /**
   * Answers a side quest (plan §4.6): marked against its key, or one Coach
   * note for a written answer. Ungraded; the server moves the card to done
   * and Ally follows up on her own. A card already done is shown as done.
   */
  const answerPractice = useCallback(
    async (cardId: string, request: GuideMicroActivityRequest) => {
      if (!threadId || identityRef.current === "visitor") return;
      setPractice(prev => ({ ...prev, [cardId]: { status: "sending", request } }));
      try {
        const result = await answerGuideMicroActivity({ threadId, cardId, body: request }).unwrap();
        setPractice(prev => ({ ...prev, [cardId]: { status: "done", request, result } }));
        dispatch({ type: "card/localState", cardId, state: "done" });
        const card = feedRef.current.cards[cardId];
        track(ANALYTICS_EVENTS.GUIDED_PRACTICE_ANSWERED, {
          ...courseProps,
          [ANALYTICS_PROPS.GUIDED_PRACTICE_KIND]:
            result.kind ??
            ((card?.payload as { activity?: { kind?: string } } | undefined)?.activity?.kind ||
              "unknown"),
        });
      } catch (error) {
        const data = (error as { data?: { message?: unknown } } | undefined)?.data;
        const message = typeof data?.message === "string" ? data.message : undefined;
        setPractice(prev => ({ ...prev, [cardId]: { status: "error", request, message } }));
      }
    },
    [threadId, answerGuideMicroActivity, track, courseProps],
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
      [ANALYTICS_PROPS.GUIDED_IDENTITY]: identityRef.current,
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
      // A visitor has no prefs on the server yet: this device remembers it.
      if (identityRef.current === "learner") {
        void putGuidePrefs({ guidance: level })
          .unwrap()
          .catch(() => undefined);
      }
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

  /**
   * The course's language, for a signed-in learner (it is saved on the
   * enrolment, as in classic). The page reloads its view in the new language;
   * Ally answers in it from the next turn.
   */
  const setCourseLanguage = useCallback(
    async (languageCode: string) => {
      if (identityRef.current !== "learner") return;
      await setTrackLanguage({ trackId, languageCode }).unwrap();
      track(ANALYTICS_EVENTS.GUIDED_LANGUAGE_CHANGED, {
        ...courseProps,
        [ANALYTICS_PROPS.LANGUAGE]: languageCode,
      });
      retryBoot();
    },
    [setTrackLanguage, trackId, track, courseProps, retryBoot],
  );

  /** The finale's look back in a week (`purpose: spaced_recall`), at the time suggested or chosen. */
  const scheduleRecall = useCallback(
    async (at: Date, timezone: string) => {
      if (!threadId) throw new Error("no thread");
      await putGuideAppointment({
        threadId,
        body: { at: at.toISOString(), timezone, purpose: "spaced_recall" },
      }).unwrap();
      track(ANALYTICS_EVENTS.GUIDED_FINALE_DOOR, {
        ...courseProps,
        [ANALYTICS_PROPS.GUIDED_DOOR]: "spaced_recall",
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

  function trackClaim(outcome: ClaimOutcome) {
    track(ANALYTICS_EVENTS.GUIDED_VISITOR_CLAIMED, {
      ...courseProps,
      [ANALYTICS_PROPS.GUIDED_CLAIM_OUTCOME]: outcome,
    });
  }

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
        practiceItems: practiceItemIds(
          feed.entries,
          feed.cards,
          feed.progress?.currentItemId ?? null,
        ),
      }),
    [bootstrap?.spine, feed.progress, feed.cards, feed.entries],
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
    practice,
    ratings,
    minimisedCardId,
    helpRequested,
    identity,
    claiming,
    claimDenied,
    actions: {
      retryBoot,
      signedIn,
      setCourseLanguage,
      consumeHeldText: () => dispatch({ type: "held/consumed" }),
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
      answerPractice,
      askAbout,
      rateMessage,
      scheduleRecall,
      setGuidance,
      scheduleAppointment,
      chooseSafe,
      chooseNeedHelp,
      trackClassic,
    },
  };
};

export type GuideJourney = ReturnType<typeof useGuideJourney>;

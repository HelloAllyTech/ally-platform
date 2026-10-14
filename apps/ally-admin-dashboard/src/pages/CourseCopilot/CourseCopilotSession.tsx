import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  Button,
  InlineNotification,
  SidePanel,
  SkeletonText,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import {
  useApproveCourseCopilotBlueprintMutation,
  useArchiveCourseCopilotSessionMutation,
  useCancelCourseCopilotBuildMutation,
  useCreateCourseCopilotSessionMutation,
  useGetCourseCopilotSessionQuery,
  useRaiseCourseCopilotBudgetMutation,
  useRetryCourseCopilotBuildMutation,
  useUpdateCourseCopilotBlueprintMutation,
} from "@api";
import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
import { AgentAnswerPayload, ChatComposer, ChatMessage } from "@components/agent-chat";
import { CourseCopilotWorkPane } from "@components/course-copilot";
import { ErrorBoundary } from "@components/error-boundary";
import { ButtonVariant } from "@components/types";
import { en, LOCAL_STORAGE_KEYS, ROUTES } from "@constants";
import { useCourseCopilotSocket, useCourseCopilotStream } from "@hooks";
import { COURSE_COPILOT_KICKOFF_MESSAGE } from "@hooks/useCourseCopilotStream";
import {
  CourseBlueprint,
  CourseBrief,
  CourseBriefReadiness,
  CourseCopilotBlueprintResponse,
  CourseCopilotEvent,
  CourseCopilotSessionDetail,
  CourseCopilotSessionStatus,
  CourseOutline,
} from "@types";

import { errorMessageFrom, errorStatusOf } from "./courseCopilotErrors";
import { changedItemIds, formatUsd, mergeEvents } from "./courseCopilotLive";
import { CourseCopilotStatusTag } from "./CourseCopilotStatusTag";

/**
 * While a build runs, the detail is polled even if the socket is up: the build may be running on
 * another server instance whose pushes never reach this connection. Polling is the guarantee; the
 * socket is the speed-up.
 */
const POLL_INTERVAL_MS = 5000;
/** Socket events and mid-turn patches are invalidation signals; bursts collapse into one refetch. */
const REFETCH_DEBOUNCE_MS = 750;
/** How long a changed outline node keeps its "just changed" highlight. */
const FLASH_MS = 2500;
const MAX_SOCKET_EVENTS = 200;
const ACTIVE_JOB_STATUSES = ["queued", "running"];

const LG_QUERY = "(min-width: 1024px)";

/**
 * Whether the viewport is at least Tailwind's `lg`. The work pane is mounted in exactly one place —
 * the aside above `lg`, a sheet below it — rather than hidden with CSS: two live copies of an
 * editable blueprint tree would each hold their own unsaved edits.
 */
const useIsLargeScreen = (): boolean => {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia(LG_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(LG_QUERY);
    const onChange = () => setMatches(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return matches;
};

/**
 * One Course Copilot session: the conversation on the left, the work product on the right.
 *
 * The chat feed is seeded from the server once per session and then advanced by the SSE stream;
 * `detail` (the polled/refetched session) feeds the work pane. Between the two sit a handful of
 * "live" overlays — the brief, blueprint, outline and status the stream reported mid-turn — that
 * make the pane keep pace with the sentence that produced a change instead of lagging a round
 * trip behind it. Each overlay is dropped the moment a fresher server snapshot arrives after the
 * turn settles, so the server stays the authority and nothing stale lingers.
 */
export const CourseCopilotSession: React.FC = () => {
  const strings = en.courseCopilot;
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const isLargeScreen = useIsLargeScreen();

  /* ── Live overlays (see the doc comment) ─────────────────────────────── */
  const [statusOverlay, setStatusOverlay] = useState<CourseCopilotSessionStatus | null>(null);
  const [liveBrief, setLiveBrief] = useState<CourseBrief | null>(null);
  const [liveReadiness, setLiveReadiness] = useState<CourseBriefReadiness | null>(null);
  const [liveBlueprint, setLiveBlueprint] = useState<CourseCopilotBlueprintResponse | null>(null);
  const [liveOutline, setLiveOutline] = useState<CourseOutline | null>(null);
  const [flashItemIds, setFlashItemIds] = useState<string[]>([]);
  const [socketEvents, setSocketEvents] = useState<CourseCopilotEvent[]>([]);

  const [showPaneSheet, setShowPaneSheet] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  // Set when the server session vanished and a replacement could not be created — the composer
  // is replaced by a "go back" state rather than a turn that silently goes nowhere.
  const [sessionGone, setSessionGone] = useState(false);
  /** Whether the detail is worth polling: a build or queued jobs are moving it on their own. */
  const [isLive, setIsLive] = useState(false);

  const hydratedForRef = useRef<string | null>(null);
  const kickoffSentRef = useRef<string | null>(null);
  /** An id this page itself navigated to after replacing a lost session — keep the feed. */
  const replacementIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveOutlineRef = useRef<CourseOutline | null>(null);

  const {
    data,
    isLoading,
    isError,
    error: loadError,
    refetch,
  } = useGetCourseCopilotSessionQuery(
    { id: sessionId },
    {
      skip: !sessionId,
      pollingInterval: isLive ? POLL_INTERVAL_MS : 0,
      skipPollingIfUnfocused: true,
    },
  );
  // After a session replacement `data` still holds the previous session until the new fetch lands.
  const detail: CourseCopilotSessionDetail | undefined =
    data?.session?.id === sessionId ? data : undefined;

  const [createSession] = useCreateCourseCopilotSessionMutation();
  const [archiveSession, { isLoading: isArchiving }] = useArchiveCourseCopilotSessionMutation();
  const [updateBlueprint] = useUpdateCourseCopilotBlueprintMutation();
  const [approveBlueprint] = useApproveCourseCopilotBlueprintMutation();
  const [retryBuild] = useRetryCourseCopilotBuildMutation();
  const [cancelBuild] = useCancelCourseCopilotBuildMutation();
  const [raiseBudget] = useRaiseCourseCopilotBudgetMutation();

  const effectiveStatus: CourseCopilotSessionStatus | undefined =
    statusOverlay ?? detail?.session.status;

  // Stream callbacks are created once and read the latest values through refs, so the hooks below
  // (and the kickoff effect that depends on `sendMessage`) never re-fire on a re-render. The refs
  // are synced after commit (below), not during render.
  const detailRef = useRef(detail);
  const statusRef = useRef(effectiveStatus);
  const refetchRef = useRef(refetch);
  const isStreamingRef = useRef(false);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      void refetchRef.current();
    }, REFETCH_DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  /* ── Stream ──────────────────────────────────────────────────────────── */

  const handleBrief = useCallback((brief: CourseBrief, readiness: CourseBriefReadiness) => {
    setLiveBrief(brief);
    setLiveReadiness(readiness);
  }, []);

  const handleBlueprint = useCallback((response: CourseCopilotBlueprintResponse) => {
    setLiveBlueprint(response);
    // The pane switches to the Blueprint tab on the frame, not at the end of the turn — the status
    // only catches up on `done`, so say so here.
    if (statusRef.current === "INTERVIEWING") setStatusOverlay("AWAITING_BLUEPRINT");
  }, []);

  const handleCoursePatch = useCallback(
    ({ outline }: { summary: string; outline: CourseOutline | null }) => {
      const changed = changedItemIds(liveOutlineRef.current ?? detailRef.current?.outline, outline);
      if (outline) {
        liveOutlineRef.current = outline;
        setLiveOutline(outline);
      }
      if (changed.length) {
        setFlashItemIds(changed);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setFlashItemIds([]), FLASH_MS);
      }
      // The change log and per-item previews live on the session, not in the patch.
      scheduleRefetch();
    },
    [scheduleRefetch],
  );

  // A turn that fails because its session is gone is replayed ONCE against a replacement (the
  // stream hook owns the "once"). EDIT sessions are re-bound to the same course — the server
  // returns the caller's active session for it — so the trainer lands back in the same place.
  const handleSessionInvalid = useCallback(async (): Promise<string | null> => {
    try {
      const trackId = detailRef.current?.session.trackId ?? undefined;
      const fresh = await createSession(trackId ? { trackId } : undefined).unwrap();
      // The feed on screen IS the conversation; do not re-seed it from the empty replacement.
      hydratedForRef.current = fresh.id;
      kickoffSentRef.current = fresh.id;
      replacementIdRef.current = fresh.id;
      localStorage.setItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID, fresh.id);
      navigate(ROUTES.COURSE_COPILOT_SESSION(fresh.id), { replace: true });
      return fresh.id;
    } catch {
      setSessionGone(true);
      toast.error(strings.session.sessionGone);
      return null;
    }
  }, [createSession, navigate, strings.session.sessionGone]);

  const {
    messages,
    isStreaming,
    sendMessage,
    retryLast,
    stop,
    hydrateMessages,
    syncServerMessages,
    resetMessages,
  } = useCourseCopilotStream({
    sessionId: sessionId || null,
    onBrief: handleBrief,
    onBlueprint: handleBlueprint,
    onCoursePatch: handleCoursePatch,
    onBuildStarted: scheduleRefetch,
    onDone: done => setStatusOverlay(done.sessionStatus),
    // Stopped and failed turns end without `done` but may still have written something.
    onTurnEnd: scheduleRefetch,
    onSessionInvalid: handleSessionInvalid,
  });

  // Declared before every effect that reads these refs, so within one commit they are current.
  useEffect(() => {
    detailRef.current = detail;
    statusRef.current = effectiveStatus;
    refetchRef.current = refetch;
    isStreamingRef.current = isStreaming;
  });

  /* ── Socket ──────────────────────────────────────────────────────────── */

  const handleSocketEvents = useCallback(
    (events: CourseCopilotEvent[]) => {
      setSocketEvents(prev => [...prev, ...events].slice(-MAX_SOCKET_EVENTS));
      scheduleRefetch();
    },
    [scheduleRefetch],
  );
  const { markSeen } = useCourseCopilotSocket({
    sessionId: sessionId || null,
    onEvents: handleSocketEvents,
    onMissedWindow: scheduleRefetch,
    enabled: effectiveStatus !== "ARCHIVED",
  });

  /* ── Effects ─────────────────────────────────────────────────────────── */

  // Moving to a different session while mounted (a link between sessions) starts from nothing.
  // Declared before the hydration effect so, on mount, the reset lands first.
  useEffect(() => {
    if (replacementIdRef.current === sessionId) {
      replacementIdRef.current = null;
      return;
    }
    hydratedForRef.current = null;
    kickoffSentRef.current = null;
    liveOutlineRef.current = null;
    resetMessages();
    setStatusOverlay(null);
    setLiveBrief(null);
    setLiveReadiness(null);
    setLiveBlueprint(null);
    setLiveOutline(null);
    setFlashItemIds([]);
    setSocketEvents([]);
    setSessionGone(false);
  }, [sessionId, resetMessages]);

  // Seed the feed once per session; after that only fold in what the server added outside any
  // turn. Re-seeding on every refetch would clobber an in-flight stream with an older snapshot.
  useEffect(() => {
    if (!detail) return;
    if (hydratedForRef.current !== sessionId) {
      hydratedForRef.current = sessionId;
      hydrateMessages(detail.messages);
      localStorage.setItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID, sessionId);
      // A brand-new session opens with a hidden kickoff turn so the copilot asks its first
      // question without the trainer typing anything. An EDIT session starts from the course,
      // so it waits for the trainer.
      if (
        detail.messages.length === 0 &&
        detail.session.status === "INTERVIEWING" &&
        kickoffSentRef.current !== sessionId
      ) {
        kickoffSentRef.current = sessionId;
        void sendMessage(COURSE_COPILOT_KICKOFF_MESSAGE, undefined, true);
      }
      return;
    }
    syncServerMessages(detail.messages);
  }, [detail, sessionId, hydrateMessages, sendMessage, syncServerMessages]);

  // A fresh server snapshot after a turn settles is the authority again: drop the overlays the
  // stream put on top of the previous one. Not while a turn streams — that snapshot is older than
  // the turn.
  useEffect(() => {
    if (!detail || isStreamingRef.current) return;
    liveOutlineRef.current = null;
    setStatusOverlay(null);
    setLiveBrief(null);
    setLiveReadiness(null);
    setLiveBlueprint(null);
    setLiveOutline(null);
  }, [detail]);

  // Events the detail already carries must not re-trigger a refetch when the socket repeats them.
  useEffect(() => {
    if (detail?.events) markSeen(detail.events);
  }, [detail, markSeen]);

  // Poll while the detail is moving on its own: a build is running, or jobs are queued/running
  // (an edit tool's regenerated item, the reviewer's post-build pass — which lands AFTER the status
  // flips to EDITING). Derived during render rather than in an effect, so the polling option the
  // query reads next render is never a frame behind the data that justifies it.
  const hasActiveJobs = (detail?.jobs ?? []).some(job => ACTIVE_JOB_STATUSES.includes(job.status));
  const shouldPoll = effectiveStatus === "BUILDING" || hasActiveJobs;
  if (shouldPoll !== isLive) setIsLive(shouldPoll);

  // A 404 means this id will never resolve; do not let it be pinned as "the session to resume".
  useEffect(() => {
    if (isError && errorStatusOf(loadError) === 404) {
      if (localStorage.getItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID) === sessionId) {
        localStorage.removeItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID);
      }
    }
  }, [isError, loadError, sessionId]);

  // Keep the feed pinned to the latest message — but only if the trainer has not scrolled up to
  // read something; yanking them back down mid-sentence is worse than not following.
  useEffect(() => {
    const node = scrollRef.current;
    if (node && stickToBottomRef.current) node.scrollTop = node.scrollHeight;
  }, [messages]);
  const handleFeedScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
  };

  /* ── Pane callbacks ──────────────────────────────────────────────────── */

  const handleBlueprintSave = useCallback(
    async (blueprint: CourseBlueprint, version: number) => {
      try {
        const response = await updateBlueprint({ id: sessionId, blueprint, version }).unwrap();
        setLiveBlueprint(response);
        return response;
      } catch (error) {
        if (errorStatusOf(error) === 409) {
          // Someone — usually the copilot, from the chat — saved a newer version. Overwriting it
          // would lose that edit, so reload what is current instead.
          toast.error(strings.session.saveStale);
          void refetchRef.current();
        } else {
          toast.error(errorMessageFrom(error, strings.session.saveFailed));
        }
        return null;
      }
    },
    [sessionId, strings.session.saveFailed, strings.session.saveStale, updateBlueprint],
  );

  const handleApprove = useCallback(
    async (version: number) => {
      try {
        await approveBlueprint({ id: sessionId, version }).unwrap();
        setStatusOverlay("BUILDING");
        return true;
      } catch (error) {
        if (errorStatusOf(error) === 409) {
          toast.error(strings.session.approveStale);
          void refetchRef.current();
        } else {
          // A 400 lists what blocks approval, in the server's words.
          toast.error(errorMessageFrom(error, strings.session.approveFailed));
        }
        return false;
      }
    },
    [approveBlueprint, sessionId, strings.session.approveFailed, strings.session.approveStale],
  );

  const handleRetryJobs = useCallback(
    async (jobIds?: string[]) => {
      try {
        await retryBuild({ id: sessionId, jobIds }).unwrap();
        setStatusOverlay("BUILDING");
      } catch (error) {
        toast.error(errorMessageFrom(error, strings.session.retryFailed));
      }
    },
    [retryBuild, sessionId, strings.session.retryFailed],
  );

  const handleCancelBuild = useCallback(async () => {
    try {
      await cancelBuild(sessionId).unwrap();
    } catch (error) {
      toast.error(errorMessageFrom(error, strings.session.cancelFailed));
    }
  }, [cancelBuild, sessionId, strings.session.cancelFailed]);

  const handleRaiseBudget = useCallback(
    async (budgetUsd: number) => {
      try {
        await raiseBudget({ id: sessionId, budgetUsd }).unwrap();
        return true;
      } catch (error) {
        // "Must exceed spend" is the usual 400, and the server says so.
        toast.error(errorMessageFrom(error, strings.session.raiseFailed));
        return false;
      }
    },
    [raiseBudget, sessionId, strings.session.raiseFailed],
  );

  const trackId = detail?.session.trackId ?? null;
  const handleOpenEditor = useCallback(() => {
    if (trackId) navigate(ROUTES.EDIT_TRACK(trackId));
  }, [navigate, trackId]);

  const handleSendFromPane = useCallback(
    (text: string) => {
      if (isStreamingRef.current) return;
      void sendMessage(text);
    },
    [sendMessage],
  );

  const handleAnswer = useCallback(
    (payload: AgentAnswerPayload) =>
      // Returns the send's outcome: a refused turn resolves `false` and the card unlocks.
      sendMessage(payload.message, { questionId: payload.questionId, answer: payload.answer }),
    [sendMessage],
  );

  const handleConfirmArchive = async () => {
    setShowArchiveConfirm(false);
    try {
      await archiveSession(sessionId).unwrap();
      localStorage.removeItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID);
      toast.success(strings.list.archiveSuccess);
      navigate(ROUTES.COURSE_COPILOT);
    } catch (error) {
      toast.error(errorMessageFrom(error, strings.session.archiveFailed));
    }
  };

  /* ── What the pane sees ──────────────────────────────────────────────── */

  const paneDetail = useMemo((): CourseCopilotSessionDetail | null => {
    if (!detail) return null;
    return {
      ...detail,
      session: { ...detail.session, status: effectiveStatus ?? detail.session.status },
      outline: liveOutline ?? detail.outline,
      events: mergeEvents(detail.events, socketEvents),
    };
  }, [detail, effectiveStatus, liveOutline, socketEvents]);

  // A streamed blueprint older than the session's own (someone saved over it) must not win.
  const paneLiveBlueprint =
    liveBlueprint && liveBlueprint.version >= (detail?.session.blueprintVersion ?? 0)
      ? liveBlueprint
      : null;

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (isLoading || (!detail && !isError)) {
    return (
      <div className="p-4 md:p-6">
        <SkeletonText paragraph lineCount={5} />
      </div>
    );
  }

  if (isError || !detail || !paneDetail || !effectiveStatus) {
    return (
      <div className="flex flex-col items-start gap-3 p-4 md:p-6">
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={strings.session.loadFailed}
          className="w-full max-w-xl"
        />
        <Button kind="tertiary" size="sm" onClick={() => navigate(ROUTES.COURSE_COPILOT)}>
          {strings.start.backToList}
        </Button>
      </div>
    );
  }

  const { session, budget } = detail;
  const isArchived = effectiveStatus === "ARCHIVED";
  const isBuilding = effectiveStatus === "BUILDING";
  const composerDisabled = isArchived || sessionGone;
  // "Publish" is dropped once the course is live — offering to do what is already done reads
  // as the copilot not knowing the state it is in.
  const courseIsLive = (liveOutline ?? detail.outline)?.status === "ACTIVE";
  const chips = (strings.suggestedActions[effectiveStatus] ?? []).filter(
    chip => !(courseIsLive && chip.message === strings.publishChipMessage),
  );

  // Disabled-with-a-reason, not hidden: the trainer should know the editor exists and why it is
  // out of reach right now. The copilot rewrites the course during a build, so an edit made in
  // the editor meanwhile is silently lost.
  const editorDisabledReason = isBuilding
    ? strings.session.openInEditorBuilding
    : !trackId
      ? strings.session.openInEditorNoCourse
      : null;
  const openInEditorButton = (
    <Button
      kind="tertiary"
      size="sm"
      disabled={editorDisabledReason !== null}
      onClick={handleOpenEditor}
    >
      {strings.session.openInEditor}
    </Button>
  );

  const budgetLabel =
    budget && budget.ceilingUsd > 0
      ? strings.session.budgetOf(formatUsd(budget.spentUsd), formatUsd(budget.ceilingUsd))
      : strings.session.budgetUncapped(formatUsd(budget?.spentUsd));

  const workPane = (
    <ErrorBoundary variant="panel" resetKey={sessionId} className="m-4">
      <CourseCopilotWorkPane
        detail={paneDetail}
        liveBrief={liveBrief}
        liveBriefReadiness={liveReadiness}
        liveBlueprint={paneLiveBlueprint}
        flashItemIds={flashItemIds}
        onBlueprintSave={handleBlueprintSave}
        onApprove={handleApprove}
        onRetryJobs={handleRetryJobs}
        onCancelBuild={handleCancelBuild}
        onRaiseBudget={handleRaiseBudget}
        onOpenEditor={handleOpenEditor}
        onSendMessage={handleSendFromPane}
        isBusy={isStreaming}
      />
    </ErrorBoundary>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-neutral-200 px-4 py-3 md:flex-nowrap">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            kind="ghost"
            size="sm"
            aria-label={strings.session.backLabel}
            onClick={() => navigate(ROUTES.COURSE_COPILOT)}
          >
            ←
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-typography-900">
              {session.trackTitle || session.title || strings.session.untitled}
            </h1>
            <p className="truncate text-xs text-typography-500">
              {strings.mode[session.mode] ?? session.mode}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap">
          {!isLargeScreen && (
            <Button kind="ghost" size="sm" onClick={() => setShowPaneSheet(true)}>
              {strings.session.pane[effectiveStatus] ?? strings.title}
            </Button>
          )}
          <CourseCopilotStatusTag status={effectiveStatus} />
          <Tooltip label={strings.session.budgetTooltip} align="bottom">
            <span className="cursor-default whitespace-nowrap text-xs text-typography-600">
              {budgetLabel}
            </span>
          </Tooltip>
          {editorDisabledReason ? (
            <Tooltip label={editorDisabledReason} align="bottom">
              {/* A disabled button swallows hover, so the tooltip hangs off a wrapper. */}
              <span>{openInEditorButton}</span>
            </Tooltip>
          ) : (
            openInEditorButton
          )}
          {!isArchived &&
            (isBuilding ? (
              <Tooltip label={strings.session.archiveBuilding} align="bottom">
                <span>
                  <Button kind="ghost" size="sm" disabled>
                    {strings.session.archive}
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button
                kind="ghost"
                size="sm"
                disabled={isArchiving}
                onClick={() => setShowArchiveConfirm(true)}
              >
                {strings.session.archive}
              </Button>
            ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col border-r border-neutral-200 max-lg:border-r-0">
          <div
            ref={scrollRef}
            onScroll={handleFeedScroll}
            className="flex-1 overflow-y-auto p-4"
            data-testid="course-copilot-feed"
          >
            {messages.length === 0 && !isStreaming ? (
              <p className="mt-8 text-center text-sm text-typography-600">
                {strings.session.emptyFeed}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map(message => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    onAnswerQuestion={handleAnswer}
                    onSendSuggestion={handleSendFromPane}
                    onRetry={() => void retryLast()}
                    disabled={isStreaming || isArchived}
                  />
                ))}
              </div>
            )}
          </div>

          {sessionGone && (
            <div className="border-t border-neutral-200 p-3">
              <InlineNotification
                kind="error"
                lowContrast
                hideCloseButton
                title={strings.session.sessionGone}
              />
              <Button
                kind="tertiary"
                size="sm"
                className="mt-2"
                onClick={() => navigate(ROUTES.COURSE_COPILOT)}
              >
                {strings.start.backToList}
              </Button>
            </div>
          )}

          {isArchived && (
            <div className="border-t border-neutral-200 p-3">
              <InlineNotification
                kind="info"
                lowContrast
                hideCloseButton
                title={strings.session.archivedNotice}
              />
            </div>
          )}

          {/* State-driven chips above the composer: what is worth asking for changes with the
              session — "just build it" is a dead end once there is a blueprint, "publish" is
              premature before there is a course. Each one sends its message as the next turn.
              (Stacks: "Communicate Agent Capabilities via Visual Affordances"; "Progressive
              Disclosure and Contextual Relevance in Agent Interfaces".) */}
          {chips.length > 0 && !composerDisabled && (
            <div
              role="group"
              className="flex flex-wrap gap-2 border-t border-neutral-200 px-3 pt-3"
              aria-label={strings.chat.suggestedActionsLabel}
            >
              {chips.map(chip => (
                <Button
                  key={chip.label}
                  kind="tertiary"
                  size="sm"
                  disabled={isStreaming}
                  onClick={() => void sendMessage(chip.message)}
                >
                  {chip.label}
                </Button>
              ))}
            </div>
          )}

          <ChatComposer
            onSend={text => void sendMessage(text)}
            onStop={stop}
            isStreaming={isStreaming}
            disabled={composerDisabled}
            placeholder={strings.session.composerPlaceholder[effectiveStatus]}
          />
        </section>

        {isLargeScreen && (
          <aside className="flex w-[48%] min-w-[420px] max-w-[720px] flex-col overflow-y-auto">
            {workPane}
          </aside>
        )}
      </div>

      {!isLargeScreen && showPaneSheet && (
        <SidePanel
          open
          onClose={() => setShowPaneSheet(false)}
          title={strings.session.pane[effectiveStatus] ?? strings.title}
          className="w-[32rem]"
          bodyClassName="!p-0"
        >
          {workPane}
        </SidePanel>
      )}

      <ActionConfirmationPopup
        isOpen={showArchiveConfirm}
        onClose={() => setShowArchiveConfirm(false)}
        title={strings.list.archiveConfirmTitle}
        description={strings.list.archiveConfirmBody}
        primaryButton={{
          label: strings.list.archiveConfirm,
          onClick: () => void handleConfirmArchive(),
          variant: ButtonVariant.DESTRUCTIVE,
        }}
        secondaryButton={{
          label: strings.list.archiveCancel,
          onClick: () => setShowArchiveConfirm(false),
          variant: ButtonVariant.SECONDARY,
        }}
      />
    </div>
  );
};

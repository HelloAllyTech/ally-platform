import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LogoGithub, PullRequest as PullRequestIcon } from "@icons";
import { toast } from "sonner";

import { ActionableNotification, Button, Tag } from "@ally-ui-mono/ui-shared";
import {
  useAnswerBuilderQuestionMutation,
  useGetBuilderMilestonesQuery,
  useGetBuilderPendingQuestionsQuery,
  useGetBuilderPullRequestsQuery,
  useMergeBuilderPullRequestMutation,
  useGetBuilderPrFeedbackQuery,
  useResumeBuilderPullRequestAutomationMutation,
  useGetBuilderRunsQuery,
  useGetBuilderSessionBudgetQuery,
  useLazyGetBuilderRunEventsQuery,
} from "@api";
import { en } from "@constants";
import { useBuilderSocket } from "@hooks";
import {
  BuilderBuildEvent,
  BuilderBuildRun,
  BuilderPullRequest,
  BuilderSessionStatus,
  BuilderStage,
  BuilderTodoItem,
} from "@types";

import { BuildActivityFeed, countFeedUpdates } from "./BuildActivityFeed";
import { CollapsibleSection } from "./CollapsibleSection";
import {
  isChainedIssueSession,
  isIssueRun,
  isRunActive,
  issueRunPullRequest,
  issueRunRepo,
  latestBuildRun,
  repoMilestones,
  sameRepo,
  withoutRestatedStatus,
} from "./issueBuild";
import { IssueRail } from "./IssueRail";
import { NeedsHumanBlock, openFindingsFor } from "./NeedsHumanBlock";
import { PhaseRail } from "./PhaseRail";
import { BuilderAnswerPayload, QuestionCard } from "./QuestionCard";
import { RaiseBudgetDialog } from "./RaiseBudgetDialog";
import { RepoChain } from "./RepoChain";
import { RunHistoryRail } from "./RunHistoryRail";
import { TodoPanel } from "./TodoPanel";

/** Statuses in which the build is still moving on its own. */
const LIVE_STATUSES: BuilderSessionStatus[] = ["BUILDING"];

/**
 * Poll cadences. The socket is the primary channel; polling is the safety
 * net, so it slows right down while pushing works and speeds back up when it
 * does not. A build whose socket died quietly must not look like a build that
 * stopped working.
 */
const POLL_WITH_SOCKET_MS = 20000;
const POLL_WITHOUT_SOCKET_MS = 4000;

/**
 * How often the held-budget banner re-reads the clock. The countdown it draws
 * is in whole minutes, so anything finer would repaint for nothing.
 */
const BUDGET_COUNTDOWN_TICK_MS = 20000;

const CI_TAG_TYPE: Record<string, "green" | "red" | "blue" | "gray"> = {
  success: "green",
  failure: "red",
  pending: "blue",
  none: "gray",
};

/** The newest issue run that targets this pull request's repo, if any. */
const issueRunFor = (
  pullRequest: BuilderPullRequest,
  runs: BuilderBuildRun[] | undefined,
): BuilderBuildRun | null =>
  [...(runs ?? [])]
    .reverse()
    .find(run => isIssueRun(run) && sameRepo(issueRunRepo(run), pullRequest.repo)) ?? null;

interface BuildViewProps {
  sessionId: string;
  status: BuilderSessionStatus;
  /** The session-level error, so the run does not repeat it. */
  sessionError?: string | null;
  currentStage: BuilderStage | null;
}

export const BuildView: React.FC<BuildViewProps> = ({
  sessionId,
  status,
  currentStage,
  sessionError,
}) => {
  const strings = en.builder.build;

  // One transcript per run, keyed by run id, so switching back to an older
  // run — after a resume or a retry created a new one — shows what actually
  // happened in it rather than an empty feed. The live run keeps accumulating
  // in the background in its own slot regardless of which one is on screen.
  const [eventsByRun, setEventsByRun] = useState<Record<string, BuilderBuildEvent[]>>({});
  const lastSeqByRunRef = useRef<Record<string, number>>({});
  const backfilledRunsRef = useRef<Set<string>>(new Set());
  // Runs whose events have been fetched at least once, failed fetches
  // included — so the feed can tell "loading" from "nothing yet".
  const [loadedRuns, setLoadedRuns] = useState<Set<string>>(() => new Set());

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // True until the reader picks an older run on purpose — selection then
  // stays put through a resume rather than being yanked back to the new run
  // mid-read. Picking the newest run again (including via a fresh mount)
  // re-arms it.
  const [followLive, setFollowLive] = useState(true);
  const newestRunIdRef = useRef<string | null>(null);
  const prevNewestIdRef = useRef<string | null>(null);

  const isLive = LIVE_STATUSES.includes(status);
  const isWaiting = status === "WAITING_FOR_INPUT";

  // NOTE: this is the one live query that does not back off when the socket is
  // connected, and it stays that way deliberately. `connected` comes from
  // `useBuilderSocket` further down, which itself depends on values derived
  // from `runs` — reading it here is a temporal dead zone, and untangling the
  // hook order in this component is a bigger change than five requests a
  // minute justifies.
  const { data: runs } = useGetBuilderRunsQuery(sessionId, {
    pollingInterval: isLive || isWaiting ? POLL_WITHOUT_SOCKET_MS : 0,
    skipPollingIfUnfocused: true,
  });
  // Polled with the runs: the chain moves on when a run's CI goes green, and
  // the session row alone does not say which repo is next.
  const { data: milestones } = useGetBuilderMilestonesQuery(sessionId, {
    pollingInterval: isLive || isWaiting ? POLL_WITH_SOCKET_MS : 0,
    skipPollingIfUnfocused: true,
  });
  const { data: pendingQuestions } = useGetBuilderPendingQuestionsQuery(sessionId, {
    pollingInterval: isWaiting ? POLL_WITHOUT_SOCKET_MS : 0,
    skipPollingIfUnfocused: true,
  });
  const [mergePullRequest, { isLoading: isMerging }] = useMergeBuilderPullRequestMutation();
  const [mergingId, setMergingId] = useState<string | null>(null);

  /**
   * Merge one pull request from here.
   *
   * The backend does the refusing — red checks, checks it could not read, a
   * required review GitHub will not waive — so this does not pre-judge any of
   * it. What it must do is SHOW the refusal: these are the reasons a person
   * needs in order to decide what to do next, and swallowing them into a
   * generic failure would put them back in the tab this button exists to save.
   */
  const handleMerge = useCallback(
    async (pullRequestId: string) => {
      setMergingId(pullRequestId);
      try {
        await mergePullRequest({ sessionId, pullRequestId }).unwrap();
        toast.success(strings.prMerged_toast);
      } catch (error) {
        const message =
          (error as { data?: { message?: string } })?.data?.message ?? strings.prMergeFailed;
        toast.error(message);
      } finally {
        setMergingId(null);
      }
    },
    [mergePullRequest, sessionId, strings],
  );

  const { data: pullRequests } = useGetBuilderPullRequestsQuery(sessionId, {
    pollingInterval: isLive ? POLL_WITH_SOCKET_MS : 0,
    skipPollingIfUnfocused: true,
  });
  const [fetchEvents] = useLazyGetBuilderRunEventsQuery();
  const [answerQuestion] = useAnswerBuilderQuestionMutation();

  // Findings are only read for a pull request handed to a person — they are
  // what that person needs to look at, and nothing else on the page uses them.
  const anyNeedsHuman = (pullRequests ?? []).some(
    pr => Boolean(pr.needsHumanAt) && !pr.merged && pr.state !== "closed",
  );
  const { data: prFeedback } = useGetBuilderPrFeedbackQuery(sessionId, {
    skip: !anyNeedsHuman,
  });
  const [resumeAutomation] = useResumeBuilderPullRequestAutomationMutation();
  const [resumingId, setResumingId] = useState<string | null>(null);
  const handleResume = useCallback(
    async (pullRequestId: string) => {
      setResumingId(pullRequestId);
      try {
        await resumeAutomation({ sessionId, pullRequestId }).unwrap();
        toast.success(strings.needsYou.resumed);
      } catch (error) {
        const message =
          (error as { data?: { message?: string } })?.data?.message ??
          strings.needsYou.resumeFailed;
        toast.error(message);
      } finally {
        setResumingId(null);
      }
    },
    [resumeAutomation, sessionId, strings],
  );

  /**
   * Live spend against the ceiling. Polled rather than read off the session:
   * the session detail is fetched once per mount and this number moves every
   * phase — which is the whole reason a build can hit the ceiling while
   * somebody is looking at a page that says it had headroom.
   */
  const { data: budget, refetch: refetchBudget } = useGetBuilderSessionBudgetQuery(sessionId, {
    pollingInterval: isLive || isWaiting ? POLL_WITH_SOCKET_MS : 0,
    skipPollingIfUnfocused: true,
  });
  const [showRaiseBudget, setShowRaiseBudget] = useState(false);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());

  // The hold expires on its own, so the banner has to keep counting even
  // though nothing new arrives from the server while it waits.
  const holdUntil = budget?.hold?.holdUntil ?? null;
  useEffect(() => {
    if (!holdUntil) return undefined;
    const interval = window.setInterval(
      () => setCountdownNow(Date.now()),
      BUDGET_COUNTDOWN_TICK_MS,
    );
    return () => window.clearInterval(interval);
  }, [holdUntil]);

  const holdMinutesLeft = useMemo(() => {
    if (!holdUntil) return null;
    const until = new Date(holdUntil).getTime();
    if (!Number.isFinite(until)) return null;
    return Math.max(0, Math.ceil((until - countdownNow) / 60000));
  }, [holdUntil, countdownNow]);

  const newestRun = useMemo(() => runs?.[runs.length - 1] ?? null, [runs]);
  const selectedRun = useMemo(
    () => runs?.find(run => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const isViewingLive = selectedRunId !== null && selectedRunId === newestRun?.id;
  // The latest build — reviews and design drafts run on Builder's runner
  // after and before it, and must not decide what kind of build this is.
  const latestBuild = useMemo(() => latestBuildRun(runs), [runs]);
  // The run the rail and links describe: the one on screen, or the latest
  // build before anything is selected.
  const displayRun = selectedRun ?? latestBuild ?? newestRun;
  const displayIsIssue = isIssueRun(displayRun);
  const chain = useMemo(() => repoMilestones(milestones), [milestones]);
  // The consolidated layout: the repo table carries every repo's PR, CI and
  // merge, so the rail row, the link row and the pull-request panel go.
  const chained = useMemo(() => isChainedIssueSession(runs, milestones), [runs, milestones]);

  // Merge a batch of events into whichever run each one belongs to — the
  // socket and the polling fallback both deliver events already carrying
  // their own `runId`, so this is what actually keeps two runs' transcripts
  // apart rather than the caller having to know which run is "current".
  const appendEvents = useCallback((incoming: BuilderBuildEvent[]) => {
    if (!incoming.length) return;
    setEventsByRun(previous => {
      const grouped = new Map<string, BuilderBuildEvent[]>();
      for (const event of incoming) {
        const bucket = grouped.get(event.runId);
        if (bucket) bucket.push(event);
        else grouped.set(event.runId, [event]);
      }

      let changed = false;
      const next = { ...previous };
      for (const [runId, events] of grouped) {
        const existing = next[runId] ?? [];
        const seen = new Set(existing.map(event => event.seq));
        const fresh = events.filter(event => !seen.has(event.seq));
        if (!fresh.length) continue;
        changed = true;
        // Events arrive in order and the list only grows, so the common case
        // is a plain append. Re-sorting the whole array on every socket push
        // and every poll tick made this O(n log n) per batch — O(n²) across a
        // run that can produce thousands of events.
        const lastSeq = existing.length ? existing[existing.length - 1].seq : -1;
        const inOrder = fresh.every(
          (event, i) => event.seq > (i === 0 ? lastSeq : fresh[i - 1].seq),
        );
        const merged = inOrder
          ? [...existing, ...fresh]
          : [...existing, ...fresh].sort((a, b) => a.seq - b.seq);
        next[runId] = merged;
        lastSeqByRunRef.current[runId] = Math.max(
          lastSeqByRunRef.current[runId] ?? 0,
          merged[merged.length - 1].seq,
        );
      }
      return changed ? next : previous;
    });
  }, []);

  const markSeenRef = useRef<((events: BuilderBuildEvent[]) => void) | null>(null);

  /**
   * Cursor-fetches one run's new events. Only ever marks them "seen" on the
   * socket's dedup set when the run being fetched is the live one — the
   * socket's own dedup is keyed by seq alone (see `useBuilderSocket`), and
   * seq numbers restart per run, so feeding it a historical run's seqs would
   * make it wrongly suppress the live run's next events at the same numbers.
   */
  const fetchRunEvents = useCallback(
    async (runId: string) => {
      try {
        const afterSeq = lastSeqByRunRef.current[runId] ?? 0;
        const result = await fetchEvents({ runId, afterSeq }).unwrap();
        appendEvents(result.events);
        if (runId === newestRunIdRef.current) markSeenRef.current?.(result.events);
      } catch {
        // The next tick (for the live run) or the next selection (for a
        // historical one) tries again; a transient fetch failure isn't worth
        // telling anyone about.
      } finally {
        setLoadedRuns(previous => (previous.has(runId) ? previous : new Set(previous).add(runId)));
      }
    },
    [fetchEvents, appendEvents],
  );

  const { connected, markSeen } = useBuilderSocket({
    sessionId: isLive || isWaiting ? sessionId : null,
    onEvents: appendEvents,
    // Anything emitted while the socket was down was never queued, so the gap
    // is closed by a cursor fetch on the live run rather than hoped away.
    onMissedWindow: () => {
      if (newestRunIdRef.current) void fetchRunEvents(newestRunIdRef.current);
    },
  });

  useEffect(() => {
    markSeenRef.current = markSeen;
  }, [markSeen]);

  // Track the newest run and, while following live, keep the selection moving
  // with it — a resume creates a new run and the feed should move to it
  // rather than stay pinned to the one that just paused. Once the reader has
  // picked an older run on purpose (`followLive` false), this leaves the
  // selection alone.
  useEffect(() => {
    if (!newestRun) return;
    newestRunIdRef.current = newestRun.id;
    const isNewRun = prevNewestIdRef.current !== null && prevNewestIdRef.current !== newestRun.id;
    prevNewestIdRef.current = newestRun.id;

    setSelectedRunId(previous => {
      // First look: the newest run if it is still working, otherwise the
      // latest build. A finished review or design draft is newer than the
      // build it was about, and opening the session on its transcript buried
      // the build itself.
      if (previous === null)
        return isRunActive(newestRun) ? newestRun.id : (latestBuild ?? newestRun).id;
      if (isNewRun && followLive) return newestRun.id;
      return previous;
    });
  }, [newestRun, latestBuild, followLive]);

  const handleSelectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    setFollowLive(runId === newestRunIdRef.current);
  }, []);

  // Backfill each run's transcript exactly once, the first time it's
  // selected — after that the live loop below (for the newest run) or the
  // cache itself (for a historical one, which never grows again) is enough.
  useEffect(() => {
    if (!selectedRunId || backfilledRunsRef.current.has(selectedRunId)) return;
    backfilledRunsRef.current.add(selectedRunId);
    void fetchRunEvents(selectedRunId);
  }, [selectedRunId, fetchRunEvents]);

  // Keep pulling the NEWEST run's events regardless of what's on screen —
  // this is what lets the transcript being read stay put while the live one
  // still moves underneath it.
  useEffect(() => {
    const runId = newestRun?.id;
    if (!runId) return undefined;
    void fetchRunEvents(runId);

    if (!isLive && !isWaiting) return undefined;
    const interval = window.setInterval(
      () => void fetchRunEvents(runId),
      connected ? POLL_WITH_SOCKET_MS : POLL_WITHOUT_SOCKET_MS,
    );
    return () => window.clearInterval(interval);
  }, [newestRun?.id, connected, isLive, isWaiting, fetchRunEvents]);

  /** The newest todo snapshot from the LIVE run — the agent replaces the list
   *  wholesale, and the checklist is current-progress, not a transcript, so it
   *  does not follow the reader to an older run the way the feed does. */
  const todoItems: BuilderTodoItem[] = useMemo(() => {
    const liveEvents = newestRun ? (eventsByRun[newestRun.id] ?? []) : [];
    for (let index = liveEvents.length - 1; index >= 0; index--) {
      const event = liveEvents[index];
      if (event.type === "todo" && Array.isArray(event.payload?.items)) {
        return event.payload.items as BuilderTodoItem[];
      }
    }
    return [];
  }, [eventsByRun, newestRun]);

  const handleAnswer = async (payload: BuilderAnswerPayload) => {
    try {
      const result = await answerQuestion({
        id: sessionId,
        questionId: payload.questionId,
        message: payload.message,
        answer: payload.answer as Record<string, unknown> | undefined,
      }).unwrap();
      if (result.resumed) {
        toast.success(strings.resumed);
      }
    } catch {
      toast.error(strings.answerFailed);
    }
  };

  const budgetStrings = en.builder.budget;
  const money = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : `$${value.toFixed(2)}`;

  /**
   * Two states, one control. A held run is the urgent one — its work is intact
   * but only until the window closes — and the "past the ceiling but still
   * coding" state is the warning that precedes it by one phase. Both are shown
   * above the phase rail because they are the only thing on this page a person
   * can act on to change the outcome.
   */
  // A hold is a live thing — a run sitting on the ceiling, counting down —
  // so it goes stale the moment the run ends, and a terminal session can still
  // be holding a cached one from before it stopped.
  // An issue build reports no spend, so a ceiling cannot hold or stop it.
  const newestIsIssue = isIssueRun(latestBuild);
  const budgetHeld = Boolean(budget?.hold) && (isLive || isWaiting) && !newestIsIssue;

  /**
   * Being over the ceiling is not a live thing, and this is shown on a stopped
   * session on purpose.
   *
   * It used to need the session live or waiting, on the same reasoning as the
   * hold above. For `exceeded` that is exactly backwards: the ceiling is *why*
   * the session stopped, so hiding the control on a stopped session hides the
   * only way to restart it. A session that went over budget with a question
   * still unanswered showed no spend, no banner, no Raise button and no
   * explanation — every route out was behind the thing doing the blocking, and
   * `raiseBudget` on the server has no status guard precisely because it is
   * meant to be reachable from there.
   *
   * Still hidden once a raise could not change anything: a completed or
   * cancelled session's ceiling is history.
   */
  /** A pull request still wants a decision until it is merged or closed. */
  const awaitingMerge = useMemo(
    () => (pullRequests ?? []).filter(pr => !pr.merged && pr.state !== "closed"),
    [pullRequests],
  );
  const settledPrs = useMemo(
    () => (pullRequests ?? []).filter(pr => pr.merged || pr.state === "closed"),
    [pullRequests],
  );

  const budgetOver =
    Boolean(budget?.exceeded) && status !== "COMPLETED" && status !== "CANCELLED" && !newestIsIssue;

  // In a chain, lines that only restate the table ("CI passed on …") are
  // dropped; failures, fix requests and failing-check cards stay.
  const displayedEvents = useMemo(() => {
    const selectedEvents = selectedRunId ? (eventsByRun[selectedRunId] ?? []) : [];
    return chained && displayIsIssue ? withoutRestatedStatus(selectedEvents) : selectedEvents;
  }, [chained, displayIsIssue, eventsByRun, selectedRunId]);

  const displayPr =
    displayRun && displayIsIssue ? issueRunPullRequest(displayRun, pullRequests) : null;
  const actionsLogUrl = displayIsIssue ? (displayRun?.cost?.issueWorkflowRunUrl ?? null) : null;

  // Only for a run you are actually looking at. Scrolling back to an earlier,
  // successful run of a session that later failed should not stamp this
  // session's failure onto it.
  const runError = selectedRun?.error ?? null;
  const failureTitle = sessionError ?? runError;
  // Only when it is a *second* account. With no session error the run's error
  // is already the headline, and `runError !== sessionError` is true against a
  // null — which offered a "Details" expander onto a verbatim copy of the line
  // above it.
  const failureDetail = runError && failureTitle !== runError ? runError : null;

  const feedElement = (
    <BuildActivityFeed
      events={displayedEvents}
      isLive={isLive && isViewingLive}
      isLoading={!!selectedRunId && !loadedRuns.has(selectedRunId)}
      issueBuild={displayIsIssue ? { actionsLogUrl } : null}
      failure={
        failureTitle
          ? {
              title: failureTitle,
              detail: failureDetail,
            }
          : null
      }
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col max-md:flex-none">
      {/* ActionableNotification, not InlineNotification with a button inside
          it. Carbon forbids interactive children in an InlineNotification and
          throws at render — a notification is announced to a screen reader as
          one block of text, so a control buried in it is unreachable. This is
          the component Carbon provides for a notification that has an action,
          and it takes the button as a prop rather than a child.

          It threw here only once the banner became reachable on a stopped
          session: the same markup had been rendering for live sessions, where
          a budget hold is rare enough that nobody had hit it.

          `role="status"`, not Carbon's default `alertdialog`. As an
          alertdialog it moves focus to its action button after EVERY render,
          and this view re-renders on its own while a hold counts down — so
          focus kept being pulled to "Raise budget" out of whatever the admin
          was doing. A status is announced without taking focus; the banner is
          still red and still carries the action. Escape is off because there
          is no close button: the banner goes when the hold does, and Escape
          used to hide the only way to raise the budget. */}
      {(budgetHeld || budgetOver) && budget && (
        <ActionableNotification
          inline
          role="status"
          closeOnEscape={false}
          kind={budgetHeld ? "error" : "warning"}
          lowContrast
          hideCloseButton
          title={budgetHeld ? budgetStrings.heldTitle : budgetStrings.overTitle}
          subtitle={
            budgetHeld
              ? holdMinutesLeft !== null && holdMinutesLeft <= 0
                ? budgetStrings.heldBodyExpiring
                : budgetStrings.heldBody(
                    money(budget.spentUsd),
                    money(budget.budgetUsd),
                    budgetStrings.minutesLeft(holdMinutesLeft ?? 0),
                  )
              : budgetStrings.overBody(money(budget.spentUsd), money(budget.budgetUsd))
          }
          actionButtonLabel={budgetStrings.raise}
          onActionButtonClick={() => setShowRaiseBudget(true)}
          className="m-3"
        />
      )}

      {/* The run's GitHub link rides the rail's row rather than owning a
          full-width bar at the foot of the page. It is a way out to the raw
          logs — useful, occasionally, to one person debugging — and it was
          taking more vertical space than the pull requests. */}
      <RepoChain
        milestones={milestones ?? []}
        runs={runs ?? []}
        pullRequests={pullRequests ?? []}
        selectedRunId={displayRun?.id ?? null}
        onSelectRun={handleSelectRun}
        {...(chained
          ? {
              onMerge: handleMerge,
              mergingId,
              isMerging,
              feedback: prFeedback,
              onResume: (id: string) => void handleResume(id),
              resumingId,
            }
          : {})}
      />

      {!chained && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            {/* An issue build's progress lives on its run, not on the session's
              stage, which sits at SETUP between two repos of a chain. */}
            {displayRun && displayIsIssue ? (
              <IssueRail run={displayRun} />
            ) : (
              <PhaseRail currentStage={currentStage} active={isLive} failed={status === "FAILED"} />
            )}
          </div>
          {displayRun && displayIsIssue ? (
            // Three places to go, each named — a lone GitHub icon cannot say
            // whether it opens the issue, the log or the pull request.
            <div className="mr-3 flex shrink-0 flex-wrap items-center gap-3 text-xs">
              {displayRun.issueUrl && (
                <a
                  href={displayRun.issueUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-700 hover:underline"
                >
                  {strings.issueLink(issueRunRepo(displayRun), displayRun.issueNumber ?? 0)}
                </a>
              )}
              {actionsLogUrl && (
                <a
                  href={actionsLogUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-700 hover:underline"
                >
                  {strings.actionsLogLink}
                </a>
              )}
              {displayPr?.url && (
                <a
                  href={displayPr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-700 hover:underline"
                >
                  {strings.prLink(displayPr.number)}
                </a>
              )}
            </div>
          ) : (
            selectedRun?.githubRunUrl && (
              <a
                href={selectedRun.githubRunUrl}
                target="_blank"
                rel="noreferrer"
                title={strings.watchOnGithub}
                aria-label={strings.watchOnGithub}
                className="mr-3 shrink-0 rounded p-1.5 text-typography-500 hover:bg-neutral-100 hover:text-typography-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
              >
                <LogoGithub size={16} />
              </a>
            )
          )}
        </div>
      )}

      {!chained && (
        <RunHistoryRail
          runs={runs ?? []}
          selectedRunId={selectedRunId}
          onSelect={handleSelectRun}
          // A repo chain lists each repo's build above, and picking a repo there
          // switches the feed: every run, reviews and retries included, is then
          // detail, kept one click away rather than a row of cards on top.
          folded={chain.length > 0}
        />
      )}

      {isWaiting && pendingQuestions?.length ? (
        <section className="border-y border-primary-200 bg-primary-50/40 px-4 py-3">
          <h2 className="text-sm font-semibold text-typography-900">{strings.waitingHeading}</h2>
          <p className="mt-0.5 text-xs text-typography-600">{strings.waitingBody}</p>
          <div className="mt-3 flex flex-col gap-3">
            {pendingQuestions.map(pending => (
              <QuestionCard
                key={pending.id}
                question={{ ...pending.question, id: pending.id }}
                onAnswer={handleAnswer}
                emphasised
              />
            ))}
          </div>
        </section>
      ) : null}

      <TodoPanel items={todoItems} isLive={isLive} />

      {/* The run's fate reads as the last thing that happened, in the feed,
          rather than as a banner over it. There were two of these — the
          session's error pinned under the page header and the run's own error
          below the pull request list — saying the same failure twice, on a
          screen that is mostly transcript, neither of them where the failure
          occurred.

          `sessionError` is the session's account and `selectedRun.error` the
          runner's; when they differ the second is the technical one, so it
          becomes the detail behind the expander rather than a row of its own. */}
      {chained ? (
        <>
          {/* Folded unless a repo is building: on a finished chain the table
              says everything, and the transcript is reference. */}
          <CollapsibleSection
            heading={
              displayRun && displayIsIssue
                ? en.builder.repoChain.activityHeading(issueRunRepo(displayRun) ?? "")
                : en.builder.repoChain.activityHeading(
                    displayRun ? strings.runLabel(displayRun.sequence, displayRun.mode) : "",
                  )
            }
            meta={en.builder.repoChain.activityMeta(countFeedUpdates(displayedEvents))}
            defaultOpen={isLive}
          >
            <div className="flex max-h-[60vh] min-h-[8rem] flex-col">{feedElement}</div>
          </CollapsibleSection>
          <RunHistoryRail
            runs={runs ?? []}
            selectedRunId={selectedRunId}
            onSelect={handleSelectRun}
            folded
          />
        </>
      ) : (
        feedElement
      )}

      {/* Pull requests, split by whether they still want something from you.
          Stacks' "Unattended Execution: Risk-Based Action Gating" is the frame:
          work an agent cannot finish alone becomes a pending item a person
          resolves out of band — so the one awaiting a merge is a decision, not
          a row in a list. "Dynamic visibility scaling tied to information
          urgency" is the other half: give that one weight and quiet the rest.

          Before this they were identical tiles in a collapsed section, so the
          single thing a build exists to produce — a pull request somebody has
          to look at — looked exactly like the three already merged above it. */}
      {/* A chain's pull requests live in its table rows. */}
      {!chained && awaitingMerge.length > 0 && (
        <section className="mx-3 mt-3 rounded border border-primary-200 bg-primary-50/50 p-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-typography-900">
            <PullRequestIcon size={16} />
            {awaitingMerge.length === 1
              ? strings.prAwaitingOne
              : strings.prAwaitingMany(awaitingMerge.length)}
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {awaitingMerge.map(pullRequest => {
              // An issue build's pull request is opencode's until CI is green:
              // merging it mid-fix would ship whatever commit happened to be
              // on it. Nothing auto-approves either, so once green the copy
              // says the approval is the reader's, on GitHub.
              const issueRun = issueRunFor(pullRequest, runs);
              const ciGreen = pullRequest.ciStatus === "success";
              const issueWorking = Boolean(issueRun) && isRunActive(issueRun);
              const mergeBlocked = Boolean(issueRun) && (issueWorking || !ciGreen);

              return (
                <li key={pullRequest.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <a
                      href={pullRequest.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 text-sm text-primary-700 hover:underline"
                    >
                      <span className="block truncate font-medium">
                        {pullRequest.title ?? `${pullRequest.repo} #${pullRequest.prNumber}`}
                      </span>
                      <span className="block truncate text-xs text-typography-600">
                        {pullRequest.repo} #{pullRequest.prNumber}
                      </span>
                    </a>
                    {pullRequest.needsHumanAt && (
                      <Tag type="magenta" size="sm">
                        {strings.needsYou.tag}
                      </Tag>
                    )}
                    {pullRequest.ciStatus && (
                      <Tag type={CI_TAG_TYPE[pullRequest.ciStatus] ?? "gray"} size="sm">
                        {strings.ciStatus[pullRequest.ciStatus] ?? pullRequest.ciStatus}
                      </Tag>
                    )}
                    <Button
                      size="sm"
                      disabled={isMerging || mergeBlocked}
                      onClick={() => handleMerge(pullRequest.id)}
                    >
                      {mergingId === pullRequest.id ? strings.prMerging : strings.prMerge}
                    </Button>
                  </div>
                  {pullRequest.needsHumanAt && (
                    <NeedsHumanBlock
                      pullRequest={pullRequest}
                      findings={openFindingsFor(pullRequest.id, prFeedback)}
                      onResume={id => void handleResume(id)}
                      resuming={resumingId === pullRequest.id}
                    />
                  )}
                  {issueRun && issueWorking && (
                    <p className="text-xs text-typography-600">{strings.prIssueWorking}</p>
                  )}
                  {issueRun && !issueWorking && ciGreen && (
                    <p className="text-xs text-typography-600">
                      {strings.prIssueReady}{" "}
                      <a
                        href={pullRequest.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-700 hover:underline"
                      >
                        {strings.prIssueOpenOnGithub}
                      </a>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Settled ones are a record, not a task: one quiet line each, collapsed. */}
      {!chained && settledPrs.length > 0 && (
        <CollapsibleSection heading={strings.pullRequestsHeading} meta={String(settledPrs.length)}>
          <ul className="flex flex-col gap-1">
            {settledPrs.map(pullRequest => (
              <li key={pullRequest.id} className="flex items-center gap-2 text-xs">
                <Tag type={pullRequest.merged ? "green" : "gray"} size="sm">
                  {pullRequest.merged ? strings.prMerged : strings.prClosed}
                </Tag>
                <a
                  href={pullRequest.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-typography-600 hover:underline"
                >
                  {pullRequest.repo} #{pullRequest.prNumber}
                  {pullRequest.title ? ` — ${pullRequest.title}` : ""}
                </a>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {budget && (
        <RaiseBudgetDialog
          isOpen={showRaiseBudget}
          onClose={() => setShowRaiseBudget(false)}
          sessionId={sessionId}
          budget={budget}
          // The banner is driven by this query, so it has to re-read rather
          // than wait for the next 20s tick to stop saying "paused".
          onRaised={() => void refetchBudget()}
        />
      )}
    </div>
  );
};

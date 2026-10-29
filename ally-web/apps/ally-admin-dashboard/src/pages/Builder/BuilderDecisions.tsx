import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, SkeletonText, Tag, Tile } from "@ally-ui-mono/ui-shared";
import { useAnswerBuilderDecisionMutation, useGetBuilderDecisionsQuery } from "@api";
import { en, ROUTES } from "@constants";
import { BuilderDecision } from "@types";
import { formatRelativeTime, getErrorMessage } from "@utils";

import {
  countByCategory,
  DECISION_CATEGORY_FILTERS,
  DecisionCategoryFilter,
  filterDecisions,
  formatDuration,
  isTypingTarget,
  orderDecisions,
  sittingStats,
} from "./decisionFeed";
// Straight from the file, not the `@components/builder` barrel: the barrel carries BuildView
// and, behind it, the store — far more than a page that renders one card should load.
import { DecisionAnswer, DecisionCard } from "../../components/builder/DecisionCard";

/** The feed polls on its own: decisions arrive while a person is mid-sitting. */
const POLL_MS = 10_000;
/** How long an interview answer is shown as "working" before the feed stops claiming it. */
const WORKING_TTL_MS = 3 * 60_000;

/**
 * The decision feed: every pending decision across every Builder session, one
 * card at a time, with the queue beside it.
 *
 * Built around one number — decisions made per hour of a person's attention —
 * so the layout spends nothing on anything else. One card has focus and owns
 * the keyboard; the rail shows what is next so the person never wonders how
 * much is left; answering moves straight to the next card, with no
 * confirmation step, because the card already showed the trade-off and a
 * second "are you sure" is a tax on every decision to insure against a rare
 * one. Skip means later, not never. The header keeps the sitting's score.
 *
 * An interview answer runs as a background turn on the server; Builder's
 * follow-up question, if any, arrives as a new card on a later poll. The feed
 * says it is working on those so a quiet queue reads as "thinking", not
 * "finished".
 */
export const BuilderDecisions: React.FC = () => {
  const strings = en.builder.decisions;
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useGetBuilderDecisionsQuery(undefined, {
    pollingInterval: POLL_MS,
    skipPollingIfUnfocused: true,
  });
  const [answerDecision] = useAnswerBuilderDecisionMutation();

  const [category, setCategory] = useState<DecisionCategoryFilter>("all");
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  /** Decisions answered this sitting, hidden until the server stops returning them. */
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** Sessions with an interview turn running from an answer here, by when it started. */
  const [working, setWorking] = useState<Record<string, number>>({});
  const openedAtRef = useRef(Date.now());
  const [answeredAt, setAnsweredAt] = useState<number[]>([]);

  const allDecisions = useMemo(
    () => (data?.decisions ?? []).filter(decision => !answeredIds.has(decision.id)),
    [data, answeredIds],
  );
  const counts = useMemo(() => countByCategory(allDecisions), [allDecisions]);
  const ordered = useMemo(
    () => orderDecisions(filterDecisions(allDecisions, category), skippedIds),
    [allDecisions, category, skippedIds],
  );
  const active = useMemo(
    () => ordered.find(decision => decision.id === activeId) ?? ordered[0] ?? null,
    [ordered, activeId],
  );
  const activeIndex = active ? ordered.findIndex(decision => decision.id === active.id) : -1;

  // A session that has come back with a new decision is no longer "working";
  // one that never comes back stops being claimed after a while.
  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    setWorking(prev => {
      const next: Record<string, number> = {};
      for (const [sessionId, since] of Object.entries(prev)) {
        const returned = data.decisions.some(
          decision =>
            decision.sessionId === sessionId && new Date(decision.waitingSince).getTime() > since,
        );
        if (!returned && now - since < WORKING_TTL_MS) next[sessionId] = since;
      }
      return next;
    });
  }, [data]);

  useEffect(() => {
    if (isError) toast.error(strings.loadFailed);
  }, [isError, strings.loadFailed]);

  const move = useCallback(
    (delta: number) => {
      if (!ordered.length) return;
      const from = activeIndex < 0 ? 0 : activeIndex;
      const to = Math.min(ordered.length - 1, Math.max(0, from + delta));
      setActiveId(ordered[to].id);
    },
    [ordered, activeIndex],
  );

  /** Skip: to the back of the queue, and on to whatever is now first here. */
  const skip = useCallback(() => {
    if (!active) return;
    const id = active.id;
    setSkippedIds(prev => [...prev.filter(entry => entry !== id), id]);
    const next = ordered.find(decision => decision.id !== id && !skippedIds.includes(decision.id));
    setActiveId(next?.id ?? null);
  }, [active, ordered, skippedIds]);

  const openSession = useCallback(() => {
    if (active) navigate(ROUTES.BUILDER_SESSION(active.sessionId));
  }, [active, navigate]);

  const answer = useCallback(
    async (decision: BuilderDecision, body: DecisionAnswer) => {
      if (busyId) return;
      setBusyId(decision.id);
      try {
        const result = await answerDecision({ id: decision.id, ...body }).unwrap();
        // Off the queue at once; the next poll will agree.
        setAnsweredIds(prev => new Set(prev).add(decision.id));
        setAnsweredAt(prev => [...prev, Date.now()]);
        if (result.outcome === "turn_started") {
          setWorking(prev => ({ ...prev, [decision.sessionId]: Date.now() }));
        }
        const next = ordered.find(entry => entry.id !== decision.id);
        setActiveId(next?.id ?? null);
        toast.success(strings.answered[result.outcome] ?? strings.answered.turn_started);
      } catch (error) {
        // The server says exactly what was wrong ("already answered", "a
        // ceiling below what was spent"); the generic line is the fallback.
        toast.error(getErrorMessage(error, strings.answerFailed));
        void refetch();
      } finally {
        setBusyId(null);
      }
    },
    [answerDecision, busyId, ordered, refetch, strings],
  );

  // Page-level keys: moving, skipping, opening. The card owns picking and sending.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      switch (event.key) {
        case "j":
        case "J":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "k":
        case "K":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "s":
        case "S":
          event.preventDefault();
          skip();
          break;
        case "o":
        case "O":
          event.preventDefault();
          openSession();
          break;
        case "?":
          event.preventDefault();
          setShowShortcuts(value => !value);
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move, skip, openSession]);

  const stats = sittingStats(openedAtRef.current, answeredAt);
  const workingCount = Object.keys(working).length;
  // Nothing has ever loaded: "0 waiting" and "Nothing needs you" would be a guess.
  const loadFailed = isError && !data;

  const renderRail = () => (
    <aside className="flex flex-col gap-2 lg:w-72 lg:shrink-0">
      <h2 className="text-xs font-semibold tracking-wide text-typography-500">
        {strings.queue.heading}
      </h2>
      <ol className="flex flex-col gap-1" aria-label={strings.queue.heading}>
        {ordered.map((decision, index) => {
          const isActive = decision.id === active?.id;
          const isSkipped = skippedIds.includes(decision.id);
          return (
            <li key={decision.id}>
              <button
                type="button"
                onClick={() => setActiveId(decision.id)}
                aria-current={isActive ? "true" : undefined}
                className={[
                  "w-full rounded border px-3 py-2 text-left text-xs transition-colors",
                  "hover:border-primary-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                  isActive ? "border-primary-600 bg-primary-50" : "border-border-light",
                  isSkipped ? "opacity-60" : "",
                ].join(" ")}
              >
                <span className="flex items-center gap-2 text-typography-500">
                  <span className="tabular-nums">{index + 1}.</span>
                  <span>{strings.kinds[decision.kind] ?? decision.kind}</span>
                  {isSkipped && <span>· {strings.queue.skipped}</span>}
                  <span className="ml-auto whitespace-nowrap tabular-nums">
                    {formatRelativeTime(decision.waitingSince)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate font-medium text-typography-900">
                  {decision.prompt}
                </span>
                <span className="block truncate text-typography-600">{decision.sessionTitle}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );

  const renderEmpty = () => (
    <Tile className="flex flex-col items-start gap-2">
      <p className="text-sm font-semibold text-typography-900">
        {allDecisions.length ? strings.emptyFiltered : strings.emptyTitle}
      </p>
      {!allDecisions.length && <p className="text-sm text-typography-600">{strings.emptyBody}</p>}
      {!allDecisions.length && (
        <Button kind="tertiary" size="sm" onClick={() => navigate(ROUTES.BUILDER)}>
          {en.builder.tabLabel}
        </Button>
      )}
    </Tile>
  );

  // A failed read is not an empty queue. Saying "Nothing needs you" over a failure
  // would tell a person with a merge waiting that they are done.
  const renderLoadFailed = () => (
    <Tile className="flex flex-col items-start gap-2" data-testid="decisions-load-failed">
      <p className="text-sm font-semibold text-typography-900">{strings.loadFailed}</p>
      <p className="text-sm text-typography-600">{strings.loadFailedBody}</p>
      <Button kind="tertiary" size="sm" onClick={() => void refetch()}>
        {strings.retry}
      </Button>
    </Tile>
  );

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col overflow-y-auto md:p-6">
      <header className="mb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-typography-900">{strings.title}</h1>
            <p className="mt-1 text-sm text-typography-600">{strings.subtitle}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-typography-600">
            {/* The sitting's score. Only once there are two answers to measure between. */}
            {stats.decided > 0 && <span>{strings.stats.decided(stats.decided)}</span>}
            {stats.perHour !== null && (
              <Tag type="green" size="sm">
                {strings.stats.perHour(stats.perHour)}
              </Tag>
            )}
            {stats.averageSeconds !== null && (
              <span>{strings.stats.average(formatDuration(stats.averageSeconds))}</span>
            )}
            <Button kind="ghost" size="sm" onClick={() => setShowShortcuts(value => !value)}>
              {strings.shortcuts.toggle} <kbd className="ml-1 font-mono text-xs">?</kbd>
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {DECISION_CATEGORY_FILTERS.map(filter => (
            <button
              key={filter}
              type="button"
              aria-pressed={category === filter}
              onClick={() => setCategory(filter)}
              className={[
                "rounded-full border px-3 py-1 text-xs transition-colors",
                category === filter
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-neutral-300 text-typography-700 hover:border-primary-400",
              ].join(" ")}
            >
              {strings.categories[filter]} <span className="tabular-nums">{counts[filter]}</span>
            </button>
          ))}
          <span className="ml-auto text-xs text-typography-500">
            {!loadFailed && strings.waiting(allDecisions.length)}
            {workingCount > 0 && ` · ${strings.working(workingCount)}`}
          </span>
        </div>

        {showShortcuts && (
          <Tile className="mt-3 text-xs text-typography-700">
            <p className="mb-1 font-semibold">{strings.shortcuts.title}</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              <li>{strings.shortcuts.pick}</li>
              <li>{strings.shortcuts.enter}</li>
              <li>{strings.shortcuts.custom}</li>
              <li>{strings.shortcuts.skip}</li>
              <li>{strings.shortcuts.move}</li>
              <li>{strings.shortcuts.open}</li>
              <li>{strings.shortcuts.help}</li>
            </ul>
          </Tile>
        )}
      </header>

      {isLoading ? (
        <SkeletonText paragraph lineCount={6} />
      ) : loadFailed ? (
        renderLoadFailed()
      ) : !active ? (
        renderEmpty()
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs tabular-nums text-typography-500">
              {activeIndex + 1} / {ordered.length}
            </p>
            <DecisionCard
              key={active.id}
              decision={active}
              busy={busyId === active.id}
              waitingLabel={formatRelativeTime(active.waitingSince)}
              onAnswer={body => void answer(active, body)}
              onSkip={skip}
              onOpenSession={openSession}
              active={!showShortcuts}
            />
          </div>
          {renderRail()}
        </div>
      )}
    </div>
  );
};

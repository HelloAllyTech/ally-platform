import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArrowDown, BackArrowIcon, Search, ThreeDot } from "@icons";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import {
  useAnswerBuilderDecisionMutation,
  useAskBuilderSessionMutation,
  useGetBuilderNowQuery,
  useGetBuilderUpNextQuery,
  usePutBackBuilderSessionMutation,
  useStartBuilderUpNextMutation,
  useTellBuilderSessionMutation,
  useUndoBuilderDecisionMutation,
} from "@api";
import { ROUTES, en } from "@constants";
import {
  BuilderDecision,
  BuilderHistoryItem,
  BuilderHistoryQuery,
  BuilderUpNextItem,
} from "@types";

import { isTypingTarget } from "./decisionFeed";
import { CommandPalette, KeysList, PaletteItem } from "./room/CommandPalette";
import { Composer, ComposerMode } from "./room/Composer";
import { HistoryTab } from "./room/HistoryTab";
import { InProgressList } from "./room/InProgressList";
import { NowAnswer, NowCard } from "./room/NowCard";
import {
  QueueState,
  UNDO_WINDOW_MS,
  formatWait,
  reconcileQueue,
  sessionCode,
  waitTotals,
} from "./room/roomFormat";
import { RuleEditor, RuleEditorSource } from "./room/RuleEditor";
import { RulesTab } from "./room/RulesTab";
import { PendingAsk, SessionPanel } from "./room/SessionPanel";
import { Sheet } from "./room/Sheet";
import { useBuilderLive, useOnline, useRoomLayout } from "./room/useRoomEnvironment";

const strings = en.builder.room;
const POLL_MS = 10_000;

type Tab = "now" | "rules" | "history";
type SheetId = "upnext" | "putback" | "progress" | "compose" | "palette" | "keys" | "rule";

interface LastAnswer {
  decisionId: string;
  sessionId: string;
  historyId: string | null;
  until: number;
  at: number;
}

/**
 * The Builder tab: Now · Rules · History.
 *
 * Now is a desk with one hero. The decision in focus fills the right column;
 * the sessions in progress sit quietly on the left, grouped by what they wait
 * on, with Up next at the foot. A reversible answer sends at once and can be
 * undone for eight seconds; a one-way one arms first. Live updates never move
 * what you are reading — new decisions wait behind a pill.
 *
 * Every overlay (a session, a sheet, the palette) is a URL parameter pushed as
 * a history entry, so on a phone the back gesture closes it instead of leaving
 * the tab, and a link to `?decision=<id>` or `?session=<id>` works anywhere.
 */
export const BuilderRoom: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { layout, finePointer } = useRoomLayout();
  const phone = layout === "phone";
  const wide = layout === "desktop";
  const online = useOnline();

  const tab: Tab = (["now", "rules", "history"] as Tab[]).includes(params.get("tab") as Tab)
    ? (params.get("tab") as Tab)
    : "now";
  const sheet = params.get("sheet") as SheetId | null;
  const panelId = params.get("session");
  const deepLinkId = useRef(params.get("decision"));

  /* ── Data ─────────────────────────────────────────────────────────── */

  const nowQuery = useGetBuilderNowQuery(undefined, {
    pollingInterval: POLL_MS,
    skipPollingIfUnfocused: true,
  });
  const upNextQuery = useGetBuilderUpNextQuery(undefined, { pollingInterval: 60_000 });
  const { paused, refreshedAt } = useBuilderLive(() => {
    void nowQuery.refetch();
    void upNextQuery.refetch();
  });
  const [answerDecision] = useAnswerBuilderDecisionMutation();
  const [undoDecision] = useUndoBuilderDecisionMutation();
  const [startUpNext, { isLoading: starting }] = useStartBuilderUpNextMutation();
  const [putBack] = usePutBackBuilderSessionMutation();
  const [askSession, { isLoading: asking }] = useAskBuilderSessionMutation();
  const [tellSession, { isLoading: telling }] = useTellBuilderSessionMutation();

  const sessions = useMemo(() => nowQuery.data?.sessions ?? [], [nowQuery.data]);
  const decisions = useMemo(() => nowQuery.data?.decisions ?? [], [nowQuery.data]);
  const byId = useMemo(() => new Map(decisions.map(d => [d.id, d])), [decisions]);
  const sessionById = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  /* ── The queue: stable under live updates ─────────────────────────── */

  const [queue, setQueue] = useState<QueueState | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(deepLinkId.current);
  // Answered from this page (held, applied or in flight): skipped, but kept in place.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // Undone and back in focus, until the next snapshot lists them again.
  const [restored, setRestored] = useState<Set<string>>(new Set());
  // Every decision seen, so a restored card can render before the server lists it again.
  const known = useRef(new Map<string, BuilderDecision>());
  useEffect(() => {
    for (const decision of decisions) known.current.set(decision.id, decision);
    setRestored(previous => {
      const still = [...previous].filter(id => !byId.has(id));
      return still.length === previous.size ? previous : new Set(still);
    });
  }, [byId, decisions]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<LastAnswer | null>(null);
  const [deepDone, setDeepDone] = useState(false);
  const [armed, setArmed] = useState(false);
  const focusStart = useRef(Date.now());

  useEffect(() => {
    if (!nowQuery.data) return;
    setQueue(previous => {
      const next = reconcileQueue(previous, decisions, {
        now: Date.now(),
        focusedId,
        hidden,
        keep: new Set([...hidden, ...restored]),
        lastAnswered: lastAnswer ? { sessionId: lastAnswer.sessionId, at: lastAnswer.at } : null,
      });
      // The card in front was answered somewhere else: say so, then step aside.
      if (
        previous &&
        focusedId &&
        previous.order.includes(focusedId) &&
        !byId.has(focusedId) &&
        !hidden.has(focusedId) &&
        !restored.has(focusedId)
      ) {
        setElsewhere(focusedId);
        return {
          ...next,
          order: previous.order.filter(id => id === focusedId || next.order.includes(id)),
        };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowQuery.data, hidden, restored]);

  useEffect(() => {
    if (!elsewhere) return undefined;
    const timer = setTimeout(() => {
      setQueue(previous => {
        if (!previous) return previous;
        const index = previous.order.indexOf(elsewhere);
        const order = previous.order.filter(id => id !== elsewhere);
        setFocusedId(order[Math.min(index, order.length - 1)] ?? null);
        return { ...previous, order };
      });
      setElsewhere(null);
    }, 2_000);
    return () => clearTimeout(timer);
  }, [elsewhere]);

  // What the person moves through: the queue minus what they've answered.
  const order = useMemo(() => (queue?.order ?? []).filter(id => !hidden.has(id)), [queue, hidden]);
  const fresh = useMemo(() => queue?.fresh ?? [], [queue]);

  // Focus the first card once there is one; a deep link wins.
  useEffect(() => {
    if (!order.length) return;
    if (!focusedId || !order.includes(focusedId)) setFocusedId(order[0]);
  }, [order, focusedId]);

  useEffect(() => {
    focusStart.current = Date.now();
    if (focusedId && fresh.includes(focusedId)) {
      setQueue(previous =>
        previous ? { ...previous, fresh: previous.fresh.filter(id => id !== focusedId) } : previous,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId]);

  const focused: BuilderDecision | undefined = focusedId
    ? (byId.get(focusedId) ?? (restored.has(focusedId) ? known.current.get(focusedId) : undefined))
    : undefined;
  const focusedIndex = focusedId ? order.indexOf(focusedId) : -1;
  const freshSessions = useMemo(
    () => new Set(fresh.map(id => byId.get(id)?.sessionId).filter(Boolean) as string[]),
    [byId, fresh],
  );

  const move = useCallback(
    (delta: number) => {
      const index = focusedId ? order.indexOf(focusedId) : -1;
      const next = order[index + delta];
      if (next) setFocusedId(next);
    },
    [focusedId, order],
  );

  /* ── URL-backed overlays (the back gesture closes them) ───────────── */

  const pushParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      navigate({ search: next.toString() }, { state: { roomOverlay: true } });
    },
    [navigate, params],
  );

  /** Swap one overlay for another in place, so Back still returns to where you were before both. */
  const replaceParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      navigate({ search: next.toString() }, { replace: true, state: location.state });
    },
    [location.state, navigate, params],
  );

  const closeOverlay = useCallback(
    (key: "sheet" | "session") => {
      // Opened by us: step back, so Back and close agree. Arrived by link: just drop it.
      if ((location.state as { roomOverlay?: boolean } | null)?.roomOverlay) navigate(-1);
      else {
        const next = new URLSearchParams(params);
        next.delete(key);
        setParams(next, { replace: true });
      }
    },
    [location.state, navigate, params, setParams],
  );

  const openSheet = useCallback((id: SheetId) => pushParams({ sheet: id }), [pushParams]);
  const closeSheet = useCallback(() => closeOverlay("sheet"), [closeOverlay]);
  const openSession = useCallback(
    (sessionId: string) => pushParams({ session: sessionId, sheet: null, tab: null }),
    [pushParams],
  );
  const closeSession = useCallback(() => closeOverlay("session"), [closeOverlay]);
  const setTab = useCallback(
    (next: Tab) => {
      const search = new URLSearchParams();
      if (next !== "now") search.set("tab", next);
      setParams(search);
    },
    [setParams],
  );

  /* ── Answering, undo ──────────────────────────────────────────────── */

  const advanceFrom = useCallback(
    (decisionId: string, nextHidden: Set<string>) => {
      const remaining = order.filter(id => !nextHidden.has(id));
      const index = order.indexOf(decisionId);
      const after = order.slice(index + 1).find(id => !nextHidden.has(id));
      setFocusedId(after ?? remaining[remaining.length - 1] ?? null);
    },
    [order],
  );

  /**
   * The answer still on its way to the server. Undo must work the moment you
   * answer, not once the server has replied, so an undo pressed while the
   * request is in flight is queued and sent as soon as the reply lands.
   */
  const inFlight = useRef<{ decisionId: string; undoQueued: boolean } | null>(null);

  const restoreCard = useCallback((decisionId: string) => {
    setRestored(previous => new Set(previous).add(decisionId));
    setHidden(previous => {
      const next = new Set(previous);
      next.delete(decisionId);
      return next;
    });
    setFocusedId(decisionId);
    setDeepDone(false);
  }, []);

  const undo = useCallback(async () => {
    const last = lastAnswer;
    if (!last || Date.now() > last.until) {
      toast(strings.toast.nothingToUndo);
      return;
    }
    if (inFlight.current?.decisionId === last.decisionId) {
      inFlight.current.undoQueued = true;
      restoreCard(last.decisionId);
      setLastAnswer(null);
      toast(strings.toast.undone);
      return;
    }
    try {
      await undoDecision(last.decisionId).unwrap();
      restoreCard(last.decisionId);
      setLastAnswer(null);
      toast(strings.toast.undone);
    } catch {
      toast.error(strings.toast.tooLate);
    }
  }, [lastAnswer, restoreCard, undoDecision]);
  // The toast's Undo outlives the render that made it; it must call today's undo.
  const undoRef = useRef(undo);
  undoRef.current = undo;

  const [ruleSource, setRuleSource] = useState<RuleEditorSource | null>(null);
  const openRuleEditor = useCallback(
    (source: RuleEditorSource) => {
      setRuleSource(source);
      openSheet("rule");
    },
    [openSheet],
  );
  const makeRuleFromLast = useCallback(() => {
    if (!lastAnswer?.historyId) {
      toast(strings.toast.answerFirst);
      return;
    }
    openRuleEditor({
      mode: "draft",
      historyId: lastAnswer.historyId,
      sessionId: lastAnswer.sessionId,
    });
  }, [lastAnswer, openRuleEditor]);

  const send = useCallback(
    async (decision: BuilderDecision, answer: NowAnswer, label: string, oneWay: boolean) => {
      if (!online) return;
      const nextHidden = new Set(hidden).add(decision.id);
      setHidden(nextHidden);
      setErrors(previous => {
        const next = { ...previous };
        delete next[decision.id];
        return next;
      });
      advanceFrom(decision.id, nextHidden);
      const wasDeepLink = deepLinkId.current === decision.id;
      if (wasDeepLink) setDeepDone(true);
      const session = sessionById.get(decision.sessionId);
      const code = session ? sessionCode(session) : decision.sessionTitle;
      if (!oneWay) {
        // Undoable from this instant, before the server has replied.
        inFlight.current = { decisionId: decision.id, undoQueued: false };
        setLastAnswer({
          decisionId: decision.id,
          sessionId: decision.sessionId,
          historyId: null,
          until: Date.now() + UNDO_WINDOW_MS,
          at: Date.now(),
        });
      }
      try {
        const result = await answerDecision({
          id: decision.id,
          ...answer,
          client: layout,
          msToDecide: Date.now() - focusStart.current,
        }).unwrap();
        const queued = inFlight.current?.decisionId === decision.id && inFlight.current.undoQueued;
        if (inFlight.current?.decisionId === decision.id) inFlight.current = null;
        if (queued) {
          try {
            await undoDecision(decision.id).unwrap();
          } catch {
            // It reached the session after all: say so and take the card away again.
            toast.error(strings.toast.tooLate);
            setHidden(previous => new Set(previous).add(decision.id));
          }
          return;
        }
        setLastAnswer({
          decisionId: decision.id,
          sessionId: decision.sessionId,
          historyId: result.historyId ?? null,
          until: result.undoableUntil ? new Date(result.undoableUntil).getTime() : 0,
          at: Date.now(),
        });
        const message = oneWay
          ? (decision.options.find(option => answer.selectedOptionIds?.includes(option.id))
              ?.consequence ?? strings.toast.sent(code, label))
          : strings.toast.sent(code, label);
        toast(message, {
          duration: result.undoableUntil ? UNDO_WINDOW_MS : 5_000,
          ...(result.undoableUntil
            ? { action: { label: strings.toast.undo, onClick: () => void undoRef.current() } }
            : {}),
          ...(result.historyId
            ? {
                cancel: {
                  label: strings.toast.makeRule,
                  onClick: () =>
                    openRuleEditor({
                      mode: "draft",
                      historyId: result.historyId!,
                      sessionId: decision.sessionId,
                    }),
                },
              }
            : {}),
        });
      } catch (error) {
        if (inFlight.current?.decisionId === decision.id) inFlight.current = null;
        setLastAnswer(previous => (previous?.decisionId === decision.id ? null : previous));
        const status = (error as { status?: number })?.status;
        if (status === 409) {
          toast(strings.card.elsewhere(""));
          return;
        }
        // Never silent, never lost: the card comes back with the pick kept.
        setHidden(previous => {
          const next = new Set(previous);
          next.delete(decision.id);
          return next;
        });
        setErrors(previous => ({ ...previous, [decision.id]: strings.card.failed }));
        setFocusedId(decision.id);
        if (wasDeepLink) setDeepDone(false);
      }
    },
    [
      advanceFrom,
      answerDecision,
      hidden,
      layout,
      online,
      openRuleEditor,
      sessionById,
      undo,
      undoDecision,
    ],
  );

  const later = useCallback(() => {
    if (!focusedId) return;
    setQueue(previous =>
      previous
        ? { ...previous, order: [...previous.order.filter(id => id !== focusedId), focusedId] }
        : previous,
    );
    move(1);
    toast(strings.card.laterDone);
  }, [focusedId, move]);

  /* ── Up next, put back ────────────────────────────────────────────── */

  const upNext = upNextQuery.data;
  const inProgress = nowQuery.data?.inProgress ?? 0;
  const limit = nowQuery.data?.limit ?? 3;

  const start = useCallback(
    async (item: BuilderUpNextItem) => {
      try {
        await startUpNext(item.id).unwrap();
        toast(strings.upNext.started(item.code));
      } catch (error) {
        const message = (error as { data?: { message?: string } })?.data?.message;
        toast.error(message ?? strings.upNext.startFailed);
      }
    },
    [startUpNext],
  );

  const putBackSession = useCallback(
    async (sessionId: string, thenStart: boolean) => {
      const session = sessionById.get(sessionId);
      try {
        const result = await putBack(sessionId).unwrap();
        const code = session ? sessionCode(session) : "";
        toast(result.opportunityId ? strings.putBack.done(code) : strings.putBack.closed(code));
        if (panelId === sessionId) closeSession();
        else if (sheet) closeSheet();
        if (thenStart) {
          const top =
            upNext?.items.find(item => item.id !== result.opportunityId) ?? upNext?.items[0];
          if (top) await start(top);
        }
      } catch {
        toast.error(strings.putBack.failed);
      }
    },
    [closeSession, closeSheet, panelId, putBack, sessionById, sheet, start, upNext],
  );

  /* ── Ask and Tell ─────────────────────────────────────────────────── */

  const [composerMode, setComposerMode] = useState<ComposerMode>("ask");
  const [manualTarget, setManualTarget] = useState<string | null>(null);
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const contextTarget = panelId ?? focused?.sessionId ?? sessions[0]?.id ?? null;
  const target = manualTarget && sessionById.has(manualTarget) ? manualTarget : contextTarget;
  useEffect(() => setManualTarget(null), [panelId, focusedId]);

  const ask = useCallback(
    async (sessionId: string, question: string) => {
      setPendingAsk({ sessionId, question, at: new Date().toISOString() });
      if (sheet === "compose") replaceParams({ sheet: null, session: sessionId });
      else if (panelId !== sessionId) openSession(sessionId);
      try {
        await askSession({ sessionId, question }).unwrap();
        return true;
      } catch {
        toast.error(strings.composer.failed);
        return false;
      } finally {
        setPendingAsk(null);
      }
    },
    [askSession, openSession, panelId, replaceParams, sheet],
  );

  const tell = useCallback(
    async (sessionId: string, instruction: string, applyNow: boolean) => {
      try {
        const result = await tellSession({ sessionId, instruction, applyNow }).unwrap();
        toast(result.message);
        if (sheet === "compose") replaceParams({ sheet: null, session: sessionId });
        else if (panelId !== sessionId) openSession(sessionId);
        setComposerMode("ask");
        return true;
      } catch {
        toast.error(strings.composer.failed);
        return false;
      }
    },
    [openSession, panelId, replaceParams, sheet, tellSession],
  );

  const focusComposer = useCallback(
    (sessionId: string | null, mode: ComposerMode) => {
      if (sessionId) setManualTarget(sessionId);
      setComposerMode(mode);
      if (phone) openSheet("compose");
      else setFocusSignal(value => value + 1);
    },
    [openSheet, phone],
  );

  /** From the palette: on a phone the composer is a sheet that replaces it; elsewhere, close and focus. */
  const paletteCompose = useCallback(
    (sessionId: string, mode: ComposerMode) => {
      setManualTarget(sessionId);
      setComposerMode(mode);
      if (phone) replaceParams({ sheet: "compose" });
      else {
        closeSheet();
        setFocusSignal(value => value + 1);
      }
    },
    [closeSheet, phone, replaceParams],
  );

  /* ── Keyboard (fine pointer) ──────────────────────────────────────── */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (sheet === "palette") closeSheet();
        else openSheet("palette");
        return;
      }
      if (sheet || tab !== "now") return;
      if (isTypingTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const inList = (event.target as HTMLElement)?.closest?.("[data-room-list]");
      if (inList) {
        const rows = [
          ...document.querySelectorAll<HTMLButtonElement>("[data-room-list] [data-row]"),
        ];
        const index = rows.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          (rows[index + 1] ?? rows[0])?.focus();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          (rows[index - 1] ?? rows[rows.length - 1])?.focus();
          return;
        }
        if (event.key === "Escape") {
          (document.activeElement as HTMLElement)?.blur();
          return;
        }
      }
      switch (event.key) {
        case "?":
          openSheet("keys");
          return;
        case "/":
          event.preventDefault();
          focusComposer(null, "ask");
          return;
        case "Escape":
          if (panelId) closeSession();
          return;
        case "g":
        case "G":
          document.querySelector<HTMLButtonElement>("[data-room-list] [data-row]")?.focus();
          return;
        case "j":
        case "J":
          move(1);
          return;
        case "k":
        case "K":
          move(-1);
          return;
        case "z":
        case "Z":
          void undo();
          return;
        case "r":
        case "R":
          makeRuleFromLast();
          return;
        default:
      }
      if (panelId || !focused) return;
      if (event.key === "s" || event.key === "S") later();
      if (event.key === "o" || event.key === "O") openSession(focused.sessionId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeSession,
    closeSheet,
    focusComposer,
    focused,
    later,
    makeRuleFromLast,
    move,
    openSession,
    openSheet,
    panelId,
    sheet,
    tab,
    undo,
  ]);

  /* ── Swipe between cards (phone) ──────────────────────────────────── */

  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    const point = event.touches[0];
    touch.current = { x: point.clientX, y: point.clientY };
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || armed) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    // Moves between decisions, never answers one.
    if (Math.abs(dx) > 70 && Math.abs(dy) < 40) move(dx < 0 ? 1 : -1);
  };

  /* ── Title, summary ───────────────────────────────────────────────── */

  const totals = waitTotals(
    sessions,
    decisions.filter(d => !hidden.has(d.id)),
    now,
  );
  useEffect(() => {
    document.title = strings.tabTitle(totals.count);
  }, [totals.count]);

  const tail = [
    totals.stuck ? strings.summary.stuck(totals.stuck) : null,
    totals.working ? strings.summary.working(totals.working) : null,
    totals.review ? strings.summary.review(totals.review) : null,
  ].filter(Boolean) as string[];
  const showRefreshed = refreshedAt && now - refreshedAt < 3_000;

  const summary = (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border-light bg-white px-4 py-3 sm:px-6">
      <p className="text-base">
        {totals.count ? (
          <>
            <strong className="font-semibold">{strings.summary.need(totals.count)}</strong> ·{" "}
            <span className={totals.waitingMs > 30 * 60_000 ? "font-semibold text-amber-700" : ""}>
              {strings.summary.waiting(formatWait(totals.waitingMs))}
            </span>
            {totals.stale ? (
              <span className="text-typography-500"> {strings.summary.stale(totals.stale)}</span>
            ) : null}
            {tail.length ? ` · ${tail.join(" · ")}` : ""}
          </>
        ) : sessions.length ? (
          <>
            <strong className="font-semibold">{strings.summary.nothing}</strong> {tail.join(" · ")}
          </>
        ) : (
          <strong className="font-semibold">{strings.summary.idle}</strong>
        )}
      </p>
      {paused && <p className="text-xs text-typography-500">{strings.summary.paused}</p>}
      {showRefreshed ? (
        <p className="text-xs text-typography-500">{strings.summary.refreshed}</p>
      ) : null}
    </div>
  );

  /* ── Palette items ────────────────────────────────────────────────── */

  const paletteItems: PaletteItem[] = useMemo(
    () => [
      ...(upNext?.items ?? []).map(item => ({
        id: `start-${item.id}`,
        label: strings.palette.start(item.code, item.title),
        kind: strings.palette.kinds.start,
        disabled: inProgress >= limit,
        disabledLabel: strings.palette.atLimit,
        run: () => {
          closeSheet();
          void start(item);
        },
      })),
      ...sessions.flatMap(session => [
        {
          id: `go-${session.id}`,
          label: strings.palette.goTo(sessionCode(session), session.title),
          kind: strings.palette.kinds.session,
          run: () => replaceParams({ sheet: null, session: session.id }),
        },
        {
          id: `ask-${session.id}`,
          label: strings.palette.ask(sessionCode(session)),
          kind: strings.palette.kinds.ask,
          run: () => paletteCompose(session.id, "ask"),
        },
        {
          id: `tell-${session.id}`,
          label: strings.palette.tell(sessionCode(session)),
          kind: strings.palette.kinds.tell,
          run: () => paletteCompose(session.id, "tell"),
        },
      ]),
      {
        id: "new-rule",
        label: strings.palette.newRule,
        kind: strings.palette.kinds.rules,
        run: () => {
          setRuleSource({ mode: "new" });
          replaceParams({ sheet: "rule" });
        },
      },
    ],
    [closeSheet, inProgress, limit, paletteCompose, replaceParams, sessions, start, upNext],
  );

  const [historyFilter, setHistoryFilter] = useState<BuilderHistoryQuery>({});

  /* ── Render ───────────────────────────────────────────────────────── */

  const panelSession = panelId ? sessionById.get(panelId) : undefined;
  // The server no longer lists it, so draw it from what was last seen while it steps aside.
  const elsewhereDecision = elsewhere ? known.current.get(elsewhere) : undefined;
  const cardDecision = focused ?? elsewhereDecision;
  const putBackCandidates = sessions.filter(session => session.putBackEligible);
  const sheetPlacement = phone ? "bottom" : "side";
  const remaining = order.filter(id => !hidden.has(id)).length;

  const list = (
    <InProgressList
      sessions={sessions}
      now={now}
      selectedId={panelId ?? focused?.sessionId ?? null}
      freshSessions={freshSessions}
      upNext={upNext}
      inProgress={inProgress}
      limit={limit}
      starting={starting}
      onOpen={sessionId => {
        if (sheet === "progress") replaceParams({ sheet: null, session: sessionId });
        else openSession(sessionId);
      }}
      onStart={start}
      onPutBack={() => (sheet ? replaceParams({ sheet: "putback" }) : openSheet("putback"))}
      onSeeAll={() => (sheet ? replaceParams({ sheet: "upnext" }) : openSheet("upnext"))}
    />
  );

  const focusColumn = (() => {
    if (panelSession) {
      return (
        <SessionPanel
          session={panelSession}
          decisions={decisions.filter(d => d.sessionId === panelSession.id && !hidden.has(d.id))}
          pendingAsk={pendingAsk}
          showKeys={finePointer}
          onBack={closeSession}
          onAnswer={decisionId => {
            setFocusedId(decisionId);
            closeSession();
          }}
          onTellThis={text => {
            setComposerMode("tell");
            setPrefill({ text, nonce: Date.now() });
            if (phone) openSheet("compose");
          }}
          onMakeRule={historyId =>
            openRuleEditor({ mode: "draft", historyId, sessionId: panelSession.id })
          }
          onPutBack={() => void putBackSession(panelSession.id, false)}
        />
      );
    }
    if (deepDone) {
      return (
        <div className="py-8">
          <h2 className="text-[22px] leading-7 sm:text-[28px] sm:leading-9">
            {strings.deepLink.done(remaining)}
          </h2>
          <div className="mt-4 flex gap-3">
            {remaining > 0 && (
              <button
                type="button"
                className="min-h-[44px] border border-typography-900 px-5"
                onClick={() => setDeepDone(false)}
              >
                {strings.deepLink.next}
              </button>
            )}
            <button
              type="button"
              className="min-h-[44px] px-5 underline underline-offset-2"
              onClick={() => {
                deepLinkId.current = null;
                setDeepDone(false);
                setFocusedId(null);
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              {strings.deepLink.close}
            </button>
          </div>
        </div>
      );
    }
    if (nowQuery.isLoading) {
      return <div className="h-64 animate-pulse bg-neutral-100" aria-busy="true" />;
    }
    if (nowQuery.isError && !nowQuery.data) {
      return (
        <div className="py-8 text-sm">
          <p>{en.builder.decisions.loadFailed}</p>
          <p className="mt-1 text-typography-600">{en.builder.decisions.loadFailedBody}</p>
          <button type="button" className="mt-3 underline" onClick={() => nowQuery.refetch()}>
            {en.builder.decisions.retry}
          </button>
        </div>
      );
    }
    if (!cardDecision) {
      const top = upNext?.items[0];
      const working = sessions.filter(session => session.waitingOn !== "you").length;
      return (
        <div className="py-6">
          <h2 className="text-[22px] leading-7 sm:text-[28px] sm:leading-9">
            {strings.empty.title}
          </h2>
          <p className="mb-4 mt-1.5 max-w-[60ch] text-typography-600">
            {working ? strings.empty.working(working) : strings.empty.idle}
          </p>
          {deepLinkId.current && !byId.has(deepLinkId.current) && (
            <p className="mb-4 text-sm text-typography-600">{strings.deepLink.decided}</p>
          )}
          {top ? (
            <div className="max-w-[560px] border border-border-light bg-white px-5 py-4">
              <p className="text-xs font-semibold tracking-wide text-typography-600">
                {strings.groups.upNext}
              </p>
              <p className="mt-2 text-xl leading-7">
                <span className="mr-2 font-mono text-sm text-typography-500">{top.code}</span>
                {top.title}
              </p>
              {top.assessment && (
                <p className="mt-1.5 line-clamp-2 text-sm text-typography-600">{top.assessment}</p>
              )}
              <div className="mt-3.5 flex flex-wrap items-center gap-3">
                {inProgress >= limit ? (
                  <button
                    type="button"
                    className="min-h-[40px] border border-typography-900 px-4 text-sm"
                    onClick={() => openSheet("putback")}
                  >
                    {strings.upNext.putOneBack(top.code)}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={starting}
                    className="min-h-[40px] border border-typography-900 px-4 text-sm disabled:opacity-50"
                    onClick={() => start(top)}
                  >
                    {strings.upNext.startCode(top.code)}
                  </button>
                )}
                <span className="text-sm tabular-nums text-typography-500">
                  {strings.upNext.limit(inProgress, limit)}
                </span>
                <button
                  type="button"
                  className="text-sm underline underline-offset-2"
                  onClick={() => openSheet("upnext")}
                >
                  {strings.upNext.seeAll}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-typography-600">{strings.upNext.empty}</p>
          )}
        </div>
      );
    }
    const session = sessionById.get(cardDecision.sessionId);
    return (
      <div
        onTouchStart={phone ? onTouchStart : undefined}
        onTouchEnd={phone ? onTouchEnd : undefined}
      >
        {!phone && (
          <div className="mb-4 flex items-center gap-3 text-xs text-typography-500">
            <span className="tabular-nums">
              {strings.card.position(focusedIndex + 1, order.length)}
            </span>
            <button
              type="button"
              className="underline underline-offset-2 disabled:no-underline disabled:opacity-40"
              disabled={focusedIndex <= 0}
              onClick={() => move(-1)}
            >
              {strings.card.previous} {finePointer && <kbd className="font-mono">K</kbd>}
            </button>
            <button
              type="button"
              className="underline underline-offset-2 disabled:no-underline disabled:opacity-40"
              disabled={focusedIndex >= order.length - 1}
              onClick={() => move(1)}
            >
              {strings.card.next} {finePointer && <kbd className="font-mono">J</kbd>}
            </button>
            {fresh.length > 0 && (
              <button
                type="button"
                className="rounded-full bg-typography-900 px-2.5 py-0.5 font-medium text-white"
                onClick={() => setFocusedId(fresh[0])}
              >
                {strings.card.newCount(fresh.length)}
              </button>
            )}
          </div>
        )}
        <NowCard
          decision={cardDecision}
          sessionLabel={session ? sessionCode(session) : ""}
          now={now}
          active={!sheet && tab === "now" && !panelId}
          showKeys={finePointer}
          compact={phone}
          followUp={Boolean(
            lastAnswer &&
            lastAnswer.sessionId === cardDecision.sessionId &&
            lastAnswer.decisionId !== cardDecision.id &&
            fresh.includes(cardDecision.id),
          )}
          elsewhere={elsewhere === cardDecision.id ? "" : null}
          error={errors[cardDecision.id] ?? null}
          disabled={!online}
          canPutBack={Boolean(session?.putBackEligible)}
          onSend={(answer, label, oneWay) => void send(cardDecision, answer, label, oneWay)}
          onLater={later}
          onOpenSession={() => openSession(cardDecision.sessionId)}
          onPutBack={() => void putBackSession(cardDecision.sessionId, false)}
          onRetry={() =>
            setErrors(previous => {
              const next = { ...previous };
              delete next[cardDecision.id];
              return next;
            })
          }
          onArmedChange={setArmed}
        />
      </div>
    );
  })();

  const counts = {
    you: sessions.filter(s => s.waitingOn === "you").length,
    stuck: totals.stuck,
    builder: totals.working,
    review: totals.review,
  };
  const stripParts = (Object.entries(counts) as [keyof typeof counts, number][])
    .filter(([, value]) => value > 0)
    .map(([group, value]) => `${strings.groups[group]} ${value}`);

  const [moreOpen, setMoreOpen] = useState(false);
  const overflow: [string, string][] = [
    [strings.overflow.sessions, ROUTES.BUILDER_ALL_SESSIONS],
    [strings.overflow.pipeline, ROUTES.BUILDER_PIPELINE],
    [strings.overflow.scoreboard, ROUTES.BUILDER_SCOREBOARD],
    [strings.overflow.knowledge, ROUTES.BUILDER_KNOWLEDGE],
    [strings.overflow.eval, ROUTES.BUILDER_EVAL],
    [strings.overflow.settings, ROUTES.BUILDER_SETTINGS],
  ];

  return (
    <div className="flex min-h-full flex-col bg-neutral-50" data-testid="builder-room">
      <header className="sticky top-0 z-30 flex items-end gap-2 border-b border-border-light bg-white px-4 sm:gap-4 sm:px-6">
        <h1 className="flex items-center gap-2 py-3 text-sm font-semibold">
          {en.builder.tabLabel}
          {totals.count > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-typography-900 px-1.5 text-xs text-white">
              {totals.count}
            </span>
          )}
        </h1>
        <nav role="tablist" aria-label={en.builder.tabLabel} className="flex sm:ml-4">
          {(["now", "rules", "history"] as Tab[]).map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={[
                "min-h-[44px] border-b-2 px-2.5 pb-2.5 pt-3 text-sm sm:px-4",
                tab === id
                  ? "border-typography-900 font-semibold"
                  : "border-transparent text-typography-600 hover:text-typography-900",
              ].join(" ")}
            >
              {strings.tabs[id]}
            </button>
          ))}
        </nav>
        <div className="relative ml-auto flex items-center gap-1 py-1.5">
          <button
            type="button"
            aria-label={strings.find}
            onClick={() => openSheet("palette")}
            className="inline-flex h-10 items-center gap-1.5 px-2.5 text-typography-600 hover:bg-neutral-100"
          >
            <Search className="h-4 w-4" aria-hidden />
            {finePointer && (
              <kbd className="border border-neutral-500 px-1 font-mono text-[11px]">⌘K</kbd>
            )}
          </button>
          <button
            type="button"
            aria-label={strings.more}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(value => !value)}
            className="inline-flex h-10 w-10 items-center justify-center text-typography-600 hover:bg-neutral-100"
          >
            <ThreeDot className="h-4 w-4" aria-hidden />
          </button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute right-0 top-12 z-40 flex min-w-[200px] flex-col border border-border-light bg-white shadow"
            >
              {overflow.map(([label, path]) => (
                <button
                  key={path}
                  role="menuitem"
                  type="button"
                  className="min-h-[40px] px-4 text-left text-sm hover:bg-neutral-100"
                  onClick={() => navigate(path)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {!online && (
        <p
          role="status"
          className="border-b border-border-light bg-amber-50 px-4 py-2 text-sm sm:px-6"
        >
          {strings.offline}
        </p>
      )}

      {tab === "now" && (
        <>
          {summary}
          {!wide && (
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => openSheet("progress")}
              className="flex w-full items-center gap-2 border-b border-border-light bg-white px-4 py-2.5 text-left text-sm sm:px-6"
            >
              <span>
                {strings.strip(
                  stripParts.length ? stripParts : [strings.summary.idle.split(".")[0]],
                )}
              </span>
              <ArrowDown className="ml-auto h-4 w-4" aria-hidden />
            </button>
          )}
          <div
            className={
              wide
                ? "grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]"
                : "flex min-h-0 flex-1 flex-col"
            }
          >
            {wide && (
              <aside
                data-room-list
                className="overflow-y-auto border-r border-border-light bg-white pt-2"
              >
                {list}
              </aside>
            )}
            <section className="flex min-w-0 flex-col">
              <div
                className={["flex-1 px-4 pb-8 pt-4 sm:px-8 sm:pt-6", phone ? "pb-28" : ""].join(
                  " ",
                )}
              >
                <div className="max-w-[720px]">{focusColumn}</div>
              </div>
              {!phone && (
                <div className="sticky bottom-0 z-20 border-t border-border-light bg-white px-4 py-2.5 sm:px-8">
                  <div className="max-w-[720px]">
                    <Composer
                      sessions={sessions}
                      targetId={target}
                      onTarget={setManualTarget}
                      mode={composerMode}
                      onMode={setComposerMode}
                      busy={asking || telling}
                      showKeys={finePointer}
                      variant="inline"
                      focusSignal={focusSignal}
                      prefill={prefill}
                      onAsk={ask}
                      onTell={tell}
                    />
                  </div>
                </div>
              )}
            </section>
          </div>
          {phone && (
            <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border-light bg-white px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
              <button
                type="button"
                aria-label={strings.card.previous}
                disabled={focusedIndex <= 0 || Boolean(panelId)}
                onClick={() => move(-1)}
                className="inline-flex h-11 w-11 items-center justify-center disabled:opacity-30"
              >
                <BackArrowIcon className="h-5 w-5" aria-hidden />
              </button>
              <span className="text-sm tabular-nums text-typography-600">
                {order.length ? `${focusedIndex + 1} of ${order.length}` : ""}
              </span>
              <button
                type="button"
                aria-label={strings.card.next}
                disabled={focusedIndex >= order.length - 1 || Boolean(panelId)}
                onClick={() => move(1)}
                className="inline-flex h-11 w-11 items-center justify-center disabled:opacity-30"
              >
                <BackArrowIcon className="h-5 w-5 rotate-180" aria-hidden />
              </button>
              {fresh.length > 0 && (
                <button
                  type="button"
                  className="rounded-full bg-typography-900 px-2.5 py-1 text-xs font-medium text-white"
                  onClick={() => setFocusedId(fresh[0])}
                >
                  {strings.card.newCount(fresh.length)}
                </button>
              )}
              <button
                type="button"
                onClick={() => openSheet("compose")}
                className="ml-auto min-h-[44px] border border-typography-900 px-4 text-sm"
              >
                {strings.composer.askOrTell}
              </button>
            </div>
          )}
        </>
      )}

      {tab === "rules" && (
        <div className="px-4 py-6 sm:px-8">
          <RulesTab
            lastHistoryId={lastAnswer?.historyId ?? null}
            onNewRule={() => openRuleEditor({ mode: "new" })}
            onRuleFromLast={makeRuleFromLast}
            onEdit={rule => openRuleEditor({ mode: "edit", rule })}
            onHistory={rule => {
              setHistoryFilter({ ruleId: rule.id });
              setTab("history");
            }}
          />
        </div>
      )}

      {tab === "history" && (
        <div className="px-4 py-6 sm:px-8">
          <HistoryTab
            key={JSON.stringify(historyFilter)}
            initial={historyFilter}
            compact={phone}
            onMakeRule={(entry: BuilderHistoryItem) =>
              openRuleEditor({ mode: "draft", historyId: entry.id, sessionId: entry.sessionId })
            }
          />
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {fresh.length ? strings.card.newCount(fresh.length) : ""}
      </div>

      {sheet === "progress" && (
        <Sheet title={strings.groups.you} placement="bottom" onClose={closeSheet}>
          <div data-room-list className="-mx-4">
            {list}
          </div>
        </Sheet>
      )}
      {sheet === "compose" && (
        <Sheet title={strings.composer.askOrTell} placement="bottom" onClose={closeSheet}>
          <Composer
            sessions={sessions}
            targetId={target}
            onTarget={setManualTarget}
            mode={composerMode}
            onMode={setComposerMode}
            busy={asking || telling}
            showKeys={false}
            variant="sheet"
            focusSignal={1}
            prefill={prefill}
            onAsk={ask}
            onTell={tell}
          />
        </Sheet>
      )}
      {sheet === "upnext" && (
        <Sheet
          title={strings.upNext.sheetTitle(upNext?.items.length ?? 0)}
          placement={sheetPlacement}
          onClose={closeSheet}
        >
          <p className="mb-3 text-sm text-typography-600">
            {strings.upNext.sheetBody} {strings.upNext.limit(inProgress, limit)}
          </p>
          {upNext?.items.length ? (
            <ul className="-mx-4">
              {upNext.items.map(item => (
                <li
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border-light px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="mr-1.5 font-mono text-xs text-typography-500">
                        {item.code}
                      </span>
                      {item.title}
                    </p>
                    {item.assessment && (
                      <p className="mt-0.5 line-clamp-2 text-[13px] text-typography-600">
                        {item.assessment}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-typography-500">
                      {strings.upNext.meta(
                        item.voterCount,
                        item.effort,
                        strings.upNext.goals(item.goalsHelped, item.goalsAssessed),
                      )}
                    </p>
                  </div>
                  {inProgress < limit && (
                    <button
                      type="button"
                      disabled={starting}
                      className="h-9 self-start border border-typography-900 px-3 text-sm disabled:opacity-50"
                      onClick={() => start(item)}
                    >
                      {strings.upNext.start}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">{strings.upNext.empty}</p>
          )}
          {inProgress >= limit && (
            <button
              type="button"
              className="mt-4 underline underline-offset-2"
              onClick={() => replaceParams({ sheet: "putback" })}
            >
              {strings.putBack.action}
            </button>
          )}
        </Sheet>
      )}
      {sheet === "putback" && (
        <Sheet
          title={strings.putBack.title(upNext?.items[0]?.code ?? "")}
          placement={sheetPlacement}
          onClose={closeSheet}
        >
          <p className="mb-3 text-sm text-typography-600">{strings.putBack.body}</p>
          {putBackCandidates.length ? (
            <ul className="-mx-4">
              {putBackCandidates.map(session => (
                <li
                  key={session.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border-light px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="mr-1.5 font-mono text-xs text-typography-500">
                        {sessionCode(session)}
                      </span>
                      {session.title}
                    </p>
                    <p className="mt-0.5 text-xs text-typography-500">
                      {session.nowLine}
                      {!session.opportunityId ? ` · ${strings.putBack.notFromRoadmap}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="h-9 self-start border border-typography-900 px-3 text-sm"
                    onClick={() => putBackSession(session.id, true)}
                  >
                    {strings.putBack.action}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">{strings.putBack.none}</p>
          )}
        </Sheet>
      )}
      {sheet === "keys" && (
        <Sheet title={strings.keys.title} placement={sheetPlacement} onClose={closeSheet}>
          <KeysList />
        </Sheet>
      )}
      {sheet === "palette" && (
        <CommandPalette
          items={paletteItems}
          fullScreen={phone}
          onClose={closeSheet}
          onFind={q => {
            setHistoryFilter({ q });
            replaceParams({ sheet: null, session: null, tab: "history" });
          }}
        />
      )}
      {sheet === "rule" && ruleSource && (
        <RuleEditor source={ruleSource} placement={sheetPlacement} onClose={closeSheet} />
      )}
    </div>
  );
};

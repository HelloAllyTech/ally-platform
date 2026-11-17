import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";

import { Button, InlineNotification, SkeletonText } from "@ally-ui-mono/ui-shared";
import {
  useAcceptPmAgentCardMutation,
  useAnswerPmAgentCardMutation,
  useDismissPmAgentCardMutation,
  useFeedbackPmAgentCardMutation,
  useGetPmAgentCardsQuery,
  useLazyGetPmAgentPlanMdQuery,
  useReasonPmAgentCardMutation,
  useRejectPmAgentCardMutation,
  useRetryPmAgentCardMutation,
  useSkipPmAgentCardMutation,
  useUndoPmAgentCardMutation,
} from "@api";
import type { PmAgentStateResponse, PmCard, PmReasonChip } from "@types";

import { ActionBar } from "./ActionBar";
import { copy } from "./copy";
import { FeedbackDraft, FeedbackPanel } from "./FeedbackPanel";
import {
  isNeedsYou,
  isQuestion,
  isRecommendation,
  isTypingTarget,
  riskOf,
  saveTextFile,
  slugify,
} from "./format";
import { KeyboardHelp } from "./KeyboardHelp";
import { NeedsYouPanel } from "./NeedsYouPanel";
import { QuestionCard } from "./QuestionCard";
import { QueueRail } from "./QueueRail";
import { ReasonToast } from "./ReasonToast";
import { RecommendationCard } from "./RecommendationCard";
import { BreakerBanner, EmptyPanel, SetupPanel, StatusBanner, isFirstRun } from "./statePanels";
import { useOnline, usePmAgentControls } from "./usePmAgentControls";
import { InfoTip } from "../../components/ally-guide/InfoTip";

const DEFAULT_UNDO_MS = 10_000;
const REASON_TOAST_MS = 12_000;

const httpStatus = (e: unknown): number | undefined =>
  typeof e === "object" && e !== null && "status" in e
    ? Number((e as { status: unknown }).status)
    : undefined;

/** Needs-you items first, otherwise the server's order. */
export const orderForReview = (cards: PmCard[]): PmCard[] => [
  ...cards.filter(isNeedsYou),
  ...cards.filter(c => !isNeedsYou(c)),
];

export interface ReviewViewProps {
  state: PmAgentStateResponse | undefined;
  stateLoadFailed?: boolean;
  onOpenSettings: () => void;
}

/**
 * Review: queue rail plus card pane. One layout, two densities; Focus hides the rail (and is the
 * layout below 1024px, where the rail collapses to an "N of M" header). Decisions are optimistic:
 * the card leaves at once and comes back with an error toast if the server refuses.
 */
export const ReviewView: React.FC<ReviewViewProps> = ({
  state,
  stateLoadFailed,
  onOpenSettings,
}) => {
  const { data, isLoading, isError, refetch } = useGetPmAgentCardsQuery();
  const [acceptCard] = useAcceptPmAgentCardMutation();
  const [undoCard] = useUndoPmAgentCardMutation();
  const [rejectCard] = useRejectPmAgentCardMutation();
  const [reasonCard] = useReasonPmAgentCardMutation();
  const [feedbackCard] = useFeedbackPmAgentCardMutation();
  const [answerCard] = useAnswerPmAgentCardMutation();
  const [skipCard] = useSkipPmAgentCardMutation();
  const [retryCard] = useRetryPmAgentCardMutation();
  const [dismissCard] = useDismissPmAgentCardMutation();
  const [fetchPlan] = useLazyGetPmAgentPlanMdQuery();
  const controls = usePmAgentControls();
  const online = useOnline();

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decided, setDecided] = useState(0);
  const [focus, setFocus] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FeedbackDraft>>({});
  const [helpOpen, setHelpOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const lastAccept = useRef<{ card: PmCard; until: number; toastId: string | number } | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);

  const cards = useMemo(() => orderForReview(data?.cards ?? []), [data]);
  const visible = useMemo(() => cards.filter(c => !hidden.has(c.id)), [cards, hidden]);
  const current = visible.find(c => c.id === selectedId) ?? visible[0] ?? null;
  const index = current ? visible.findIndex(c => c.id === current.id) : -1;

  // Cached cards stay readable on a failed refresh, but nothing can be decided.
  const loadFailed = isError || Boolean(stateLoadFailed);
  const actionsDisabled = !online || loadFailed;

  // Cards that left the server list can be forgotten from the optimistic set.
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.cards.map(c => c.id));
    setHidden(prev => {
      const next = new Set([...prev].filter(id => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data]);

  useEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      paneRef.current?.focus();
    }
  }, [current?.id]);

  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setConfirmingId(null);
    setFeedbackId(null);
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      const from = index < 0 ? 0 : index;
      const nextIndex = Math.min(visible.length - 1, Math.max(0, from + delta));
      const next = visible[nextIndex];
      select(next.id);
      announce(copy.announce.moved(next.title, nextIndex + 1, visible.length));
    },
    [visible, index, select, announce],
  );

  /** Optimistic decision: hide at once, restore with an error toast on failure. */
  const decide = useCallback(
    async (
      card: PmCard,
      run: () => Promise<unknown>,
      opts: { announcement: string; onSuccess?: (result: unknown) => void },
    ) => {
      const i = visible.findIndex(c => c.id === card.id);
      const next = visible[i + 1] ?? visible[i - 1] ?? null;
      refocus.current = true;
      setHidden(prev => new Set(prev).add(card.id));
      setDecided(n => n + 1);
      setSelectedId(next ? next.id : null);
      setConfirmingId(null);
      setFeedbackId(null);
      announce(opts.announcement);
      try {
        const result = await run();
        opts.onSuccess?.(result);
      } catch (error) {
        setHidden(prev => {
          const copyOfPrev = new Set(prev);
          copyOfPrev.delete(card.id);
          return copyOfPrev;
        });
        setDecided(n => Math.max(0, n - 1));
        setSelectedId(card.id);
        if (httpStatus(error) === 409) {
          toast.error(copy.conflict);
          refetch();
        } else {
          toast.error(copy.decideFailed);
        }
        announce(copy.announce.restored(card.title));
      }
    },
    [visible, announce, refetch],
  );

  const undoAccept = useCallback(
    async (card: PmCard) => {
      try {
        await undoCard(card.id).unwrap();
        setHidden(prev => {
          const next = new Set(prev);
          next.delete(card.id);
          return next;
        });
        setDecided(n => Math.max(0, n - 1));
        setSelectedId(card.id);
        lastAccept.current = null;
        toast.success(copy.undone);
        announce(copy.announce.undone(card.title));
      } catch {
        toast.error(copy.undoTooLate);
      }
    },
    [undoCard, announce],
  );

  const accept = useCallback(
    (card: PmCard) => {
      if (actionsDisabled || !isRecommendation(card)) return;
      if (riskOf(card) !== "low" && confirmingId !== card.id) {
        setConfirmingId(card.id);
        return;
      }
      decide(card, () => acceptCard({ id: card.id, path: "builder" }).unwrap(), {
        announcement: copy.announce.accepted(card.title),
        onSuccess: result => {
          const until = (result as PmCard | undefined)?.undoUntil;
          const ms = until ? Math.max(1_000, Date.parse(until) - Date.now()) : DEFAULT_UNDO_MS;
          const toastId = toast(copy.acceptedToast(card.title), {
            duration: ms,
            action: { label: copy.undo, onClick: () => undoAccept(card) },
          });
          lastAccept.current = { card, until: Date.now() + ms, toastId };
        },
      });
    },
    [actionsDisabled, confirmingId, decide, acceptCard, undoAccept],
  );

  const downloadPlan = useCallback(
    (card: PmCard) => {
      if (actionsDisabled || !isRecommendation(card)) return;
      decide(
        card,
        async () => {
          await acceptCard({ id: card.id, path: "download" }).unwrap();
          try {
            const markdown = await fetchPlan(card.id).unwrap();
            saveTextFile(`${slugify(card.title)}-plan.md`, markdown);
            toast.success(copy.downloadedToast);
          } catch {
            toast.error(copy.downloadFailed);
          }
        },
        { announcement: copy.announce.accepted(card.title) },
      );
    },
    [actionsDisabled, decide, acceptCard, fetchPlan],
  );

  const pickReason = useCallback(
    async (cardId: string, reasonChip: PmReasonChip) => {
      try {
        await reasonCard({ id: cardId, reasonChip }).unwrap();
        toast.success(copy.reasonSaved);
      } catch {
        toast.error(copy.reasonFailed);
      }
    },
    [reasonCard],
  );

  const reject = useCallback(
    (card: PmCard) => {
      if (actionsDisabled) return;
      decide(card, () => rejectCard({ id: card.id }).unwrap(), {
        announcement: copy.announce.rejected(card.title),
        onSuccess: () => {
          toast.custom(
            id => (
              <ReasonToast
                title={card.title}
                onPick={chip => {
                  toast.dismiss(id);
                  pickReason(card.id, chip);
                }}
                onClose={() => toast.dismiss(id)}
              />
            ),
            { duration: REASON_TOAST_MS },
          );
        },
      });
    },
    [actionsDisabled, decide, rejectCard, pickReason],
  );

  const sendFeedback = useCallback(
    (card: PmCard, draft: FeedbackDraft, reviseNow: boolean) => {
      if (actionsDisabled) return;
      decide(
        card,
        () =>
          feedbackCard({
            id: card.id,
            text: draft.text,
            chips: draft.chips,
            reviseNow,
          }).unwrap(),
        {
          announcement: copy.announce.feedback(card.title),
          onSuccess: () => {
            toast.success(reviseNow ? copy.feedbackSentNow : copy.feedbackSent);
            setDrafts(prev => {
              const next = { ...prev };
              delete next[card.id];
              return next;
            });
          },
        },
      );
    },
    [actionsDisabled, decide, feedbackCard],
  );

  const answer = useCallback(
    (card: PmCard, body: { optionIndex?: number; customText?: string }) => {
      if (actionsDisabled) return;
      decide(card, () => answerCard({ id: card.id, ...body }).unwrap(), {
        announcement: copy.announce.answered(card.title),
        onSuccess: () => toast.success(copy.answeredToast),
      });
    },
    [actionsDisabled, decide, answerCard],
  );

  const skip = useCallback(
    (card: PmCard) => {
      if (actionsDisabled) return;
      decide(card, () => skipCard(card.id).unwrap(), {
        announcement: copy.announce.skipped(card.title),
        onSuccess: () => toast.success(copy.skippedToast),
      });
    },
    [actionsDisabled, decide, skipCard],
  );

  const retry = useCallback(
    (id: string) => {
      const card = cards.find(c => c.id === id);
      if (!card || actionsDisabled) return;
      decide(card, () => retryCard(id).unwrap(), {
        announcement: copy.retried,
        onSuccess: () => toast.success(copy.retried),
      });
    },
    [cards, actionsDisabled, decide, retryCard],
  );

  const dismiss = useCallback(
    (id: string) => {
      const card = cards.find(c => c.id === id);
      if (!card || actionsDisabled) return;
      decide(card, () => dismissCard(id).unwrap(), {
        announcement: copy.dismissed,
        onSuccess: () => toast.success(copy.dismissed),
      });
    },
    [cards, actionsDisabled, decide, dismissCard],
  );

  const toggleFeedback = useCallback((card: PmCard) => {
    setConfirmingId(null);
    setFeedbackId(id => (id === card.id ? null : card.id));
  }, []);

  // Keyboard. Kept in a ref-free effect: re-bound on each render so it always sees fresh state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (helpOpen) return;
      const key = e.key;
      const lower = key.toLowerCase();

      if (key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (key === "Escape") {
        if (feedbackId || confirmingId) {
          setFeedbackId(null);
          setConfirmingId(null);
        } else if (focus) setFocus(false);
        return;
      }
      if (lower === "z") {
        setFocus(f => !f);
        return;
      }
      if (lower === "j" || key === "ArrowDown") {
        e.preventDefault();
        move(1);
        return;
      }
      if (lower === "k" || key === "ArrowUp") {
        e.preventDefault();
        move(-1);
        return;
      }
      if (lower === "u") {
        const last = lastAccept.current;
        if (last && Date.now() < last.until) {
          toast.dismiss(last.toastId);
          undoAccept(last.card);
        }
        return;
      }
      if (!current) return;
      if (lower === "a" && isRecommendation(current) && !isNeedsYou(current)) accept(current);
      else if (lower === "r" && !isNeedsYou(current) && isRecommendation(current)) reject(current);
      else if (lower === "f" && !isNeedsYou(current) && isRecommendation(current)) {
        e.preventDefault();
        toggleFeedback(current);
      } else if (/^[1-4]$/.test(key) && isQuestion(current) && !actionsDisabled) {
        const n = Number(key) - 1;
        if (current.payload.options[n]) answer(current, { optionIndex: n });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    helpOpen,
    feedbackId,
    confirmingId,
    focus,
    current,
    actionsDisabled,
    move,
    accept,
    reject,
    answer,
    undoAccept,
    toggleFeedback,
  ]);

  if (isFirstRun(state, cards.length) && state) {
    return (
      <SetupPanel
        state={state}
        saving={controls.saving}
        onSave={async patch => {
          await controls.save(patch, copy.setupSaved);
        }}
      />
    );
  }

  const needsYouCount = visible.filter(isNeedsYou).length;
  const statusBanner = (
    <StatusBanner
      state={state}
      disabled={actionsDisabled}
      onRunNow={controls.runNow}
      onResume={controls.resumeBuilds}
      onTurnOn={controls.turnOn}
      onOpenSettings={onOpenSettings}
    />
  );

  const paneBody = current && (
    <div
      ref={paneRef}
      tabIndex={-1}
      className={`flex flex-col gap-4 outline-none ${focus ? "mx-auto max-w-3xl" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-typography-700">
        <span aria-label={`Card ${index + 1} of ${visible.length}`}>
          {copy.positionOf(index + 1, visible.length)}
          {focus && <span> · {copy.decidedCount(decided)}</span>}
        </span>
        <span className="flex items-center gap-1">
          <Button
            kind="ghost"
            size="sm"
            disabled={index <= 0}
            onClick={() => move(-1)}
            aria-label={copy.prev}
          >
            ←
          </Button>
          <Button
            kind="ghost"
            size="sm"
            disabled={index >= visible.length - 1}
            onClick={() => move(1)}
            aria-label={copy.next}
          >
            →
          </Button>
          <Button kind="tertiary" size="sm" onClick={() => setFocus(f => !f)} aria-pressed={focus}>
            {focus ? copy.exitFocus : copy.focus} <kbd className="ml-1 text-xs">Z</kbd>
          </Button>
          <InfoTip label={copy.focusTip} ariaLabel="About Focus" />
        </span>
      </div>

      {isNeedsYou(current) ? (
        <>
          <h2 className="text-xl font-semibold text-typography-900">{current.title}</h2>
          <NeedsYouPanel
            card={current}
            disabled={actionsDisabled}
            onRetry={retry}
            onDismiss={dismiss}
          />
        </>
      ) : isRecommendation(current) ? (
        <>
          <RecommendationCard card={current} focus={focus} />
          {feedbackId === current.id && (
            <FeedbackPanel
              draft={drafts[current.id] ?? { text: "", chips: [] }}
              disabled={actionsDisabled}
              onChange={d => setDrafts(prev => ({ ...prev, [current.id]: d }))}
              onSend={(d, now) => sendFeedback(current, d, now)}
              onCancel={() => setFeedbackId(null)}
            />
          )}
          <ActionBar
            card={current}
            sticky
            disabled={actionsDisabled}
            confirming={confirmingId === current.id}
            onAccept={() => accept(current)}
            onConfirmAccept={() => accept(current)}
            onCancelConfirm={() => setConfirmingId(null)}
            onDownload={() => downloadPlan(current)}
            onReject={() => reject(current)}
            onFeedback={() => toggleFeedback(current)}
          />
        </>
      ) : (
        isQuestion(current) && (
          <QuestionCard
            card={current}
            focus={focus}
            disabled={actionsDisabled}
            onPickOption={i => answer(current, { optionIndex: i })}
            onCustom={text => answer(current, { customText: text })}
            onSkip={() => skip(current)}
          />
        )
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
      <BreakerBanner state={state} disabled={actionsDisabled} onResume={controls.resumeBuilds} />
      {statusBanner}
      {!online && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title={copy.offline}
          role="status"
        />
      )}
      {online && loadFailed && (
        <div className="flex flex-wrap items-center gap-3">
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title={data ? copy.loadErrorCached : copy.loadError}
          />
          <Button kind="tertiary" size="sm" onClick={() => refetch()}>
            {copy.retryLoad}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label={copy.loading}>
          <SkeletonText paragraph lineCount={4} />
        </div>
      ) : visible.length === 0 ? (
        <>
          <EmptyPanel
            state={state}
            disabled={actionsDisabled}
            running={controls.running}
            onRunNow={controls.runNow}
          />
        </>
      ) : (
        <div className={focus ? "block" : "lg:grid lg:grid-cols-[18rem_1fr] lg:gap-4"}>
          {!focus && (
            <aside className="mb-3 hidden lg:mb-0 lg:block">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-typography-600">
                {copy.today(visible.length - needsYouCount, needsYouCount)}
              </div>
              <QueueRail cards={visible} selectedId={current?.id ?? null} onSelect={select} />
            </aside>
          )}
          <div className="min-w-0 rounded border border-neutral-500 p-4">{paneBody}</div>
        </div>
      )}

      <p className="text-xs text-typography-600">{copy.keysHint}</p>
      {helpOpen && <KeyboardHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
};

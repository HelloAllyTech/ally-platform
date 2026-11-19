import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Tick } from "@icons";
import { AnimatePresence, motion } from "framer-motion";
import { useDispatch } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, OverflowMenu, OverflowMenuItem, SkeletonText } from "@ally-ui-mono/ui-shared";
import { roadmapV2API, useGetRoadmapProductGoalsQuery, useSuggestRoadmapTitleMutation } from "@api";
import { ROUTES, en } from "@constants";

import { ChecksPanel } from "./ChecksPanel";
import { DraftConversation, TurnError } from "./DraftConversation";
import { agoText, dueSoon, errorCode, markFirstSubmit, newlyMet } from "./draftUtils";
import { HighlightedTextBox } from "./HighlightedTextBox";
import { IdeaAgentFindings } from "./IdeaAgentFindings";
import { SimilarIdeas } from "./SimilarIdeas";
import {
  SubmitChoice,
  SubmitChoiceState,
  initialSubmitChoice,
  submitChoiceProblem,
  toSubmitChoice,
} from "./SubmitChoice";
import {
  useAddRoadmapDraftToMutation,
  useDiscardRoadmapDraftMutation,
  useGetRoadmapDraftQuery,
  useReopenRoadmapDraftCheckMutation,
  useRestoreRoadmapDraftMutation,
  useRoadmapDraftTurnMutation,
  useSubmitRoadmapDraftMutation,
} from "../../../api/roadmapV2Flow";
import { haptic, motionTransition, useReducedMotionPreference } from "../../../motion";
import { BottomSheet } from "../components/BottomSheet";
import { DictationButton } from "../components/DictationButton";
import { RoadmapDialog } from "../components/RoadmapDialog";
import { RoadmapDropdown } from "../components/RoadmapDropdown";
import { typeInText } from "../hooks/useDictation";
import { DRAFT_TEXT_MAX, useDraftAutosave } from "../hooks/useDraftAutosave";
import { useOutbox } from "../hooks/useOutbox";
import { RoadmapBreakpoint } from "../hooks/useRoadmapBreakpoint";
import { useRoadmapJobTimer } from "../hooks/useRoadmapJobTimer";
import { useKeyboardInset } from "../hooks/useVisualViewport";
import { shortDate } from "../utils/copy";
import { isOfflineError } from "../utils/deviceStore";

import type { RoadmapDraftCheck, RoadmapDraftDetail } from "../../../types/roadmapV2Flow";

interface DraftViewProps {
  /** Undefined on New idea: the draft is made by the first save. */
  code?: string;
  breakpoint: RoadmapBreakpoint;
  headingRef?: React.Ref<HTMLHeadingElement>;
  initialText?: string;
}

/**
 * New idea's page (§4.2, D3, D9): the same page the idea keeps for life, in its Draft state. A
 * dashed outline and "Draft · only you can see this" until it's submitted (§4.13). The text box
 * autosaves to the device and then the server; Check my idea ticks what the words already meet,
 * quoting them; the 🎤 turns speech into editable text; Submit unlocks at 5 of 5.
 *
 * Widths (§4.17): a phone gets one column with a "3 of 5" pill that opens the checks sheet and a
 * sticky Submit; a tablet puts the checks in a side column; laptop and desktop are as the plan's
 * sketch.
 */
export const DraftView: React.FC<DraftViewProps> = ({
  code,
  breakpoint,
  headingRef,
  initialText,
}) => {
  const {
    data: draft,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetRoadmapDraftQuery(code ?? "", { skip: !code });
  const copy = en.roadmapV2;

  if (code && isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4" aria-busy="true">
        <SkeletonText heading width="40%" />
        <SkeletonText paragraph lineCount={4} />
      </div>
    );
  }
  if (code && (isError || !draft)) {
    const missing = (error as { status?: unknown })?.status === 404;
    return (
      <div className="flex flex-col items-start gap-3 p-6" role="alert">
        <p className="text-sm text-typography-primary">
          {missing ? copy.itemNotFound : copy.draft.loadError}
        </p>
        {!missing && (
          <Button kind="tertiary" size="sm" onClick={() => refetch()}>
            {copy.retry}
          </Button>
        )}
      </div>
    );
  }
  return (
    <DraftEditor
      key={code ?? "new"}
      code={code}
      draft={draft}
      breakpoint={breakpoint}
      headingRef={headingRef}
      initialText={initialText}
    />
  );
};

const DraftEditor: React.FC<DraftViewProps & { draft?: RoadmapDraftDetail }> = ({
  code,
  draft,
  breakpoint,
  headingRef,
  initialText,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.draft;
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const isPhone = breakpoint === "phone";
  const touch = isPhone || breakpoint === "tablet";
  const readOnly = !!draft?.archivedAt;

  const textRef = useRef<HTMLTextAreaElement>(null);
  const caretFromNew = (location.state as { caret?: number } | null)?.caret;

  // P8 job timing (§4.16): New idea opening starts "capture an idea", the first save (the draft
  // exists) ends it; a draft's page opening starts "draft to submitted", Submit ends it.
  const jobs = useRoadmapJobTimer();
  useEffect(() => {
    if (!code) jobs.start("capture_idea", { restart: true });
    else if (!readOnly) jobs.start("draft_to_submitted", { itemId: code });
    // On arrival, per draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, readOnly]);

  const autosave = useDraftAutosave({
    code,
    server: draft,
    initialText,
    readOnly,
    onCreated: created => {
      jobs.complete("capture_idea", { itemId: created.code });
      // The draft has its code: the page moves to it, keeping the caret where it was.
      navigate(ROUTES.ROADMAP_IDEA(created.code), {
        replace: true,
        state: { caret: textRef.current?.selectionStart ?? undefined },
      });
    },
  });

  // Coming from New idea, the caret carries over; on a fresh page focus the box for a new draft.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    if (typeof caretFromNew === "number") {
      el.focus();
      el.setSelectionRange(caretFromNew, caretFromNew);
    } else if (!code) {
      el.focus();
    }
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── turns ─────────────────────────────────────────────────────────────────────────────────────
  const [turn] = useRoadmapDraftTurnMutation();
  const [reopen] = useReopenRoadmapDraftCheckMutation();
  const [submit] = useSubmitRoadmapDraftMutation();
  const [suggestTitle] = useSuggestRoadmapTitleMutation();
  const [addTo] = useAddRoadmapDraftToMutation();
  const [discard] = useDiscardRoadmapDraftMutation();
  const [restore] = useRestoreRoadmapDraftMutation();

  const [running, setRunning] = useState(false);
  const [turnError, setTurnError] = useState<TurnError>(null);
  // "Fill it in yourself" was removed (2026-11-18): a draft is finished by its interview, so a
  // failing agent only says so, and Check my idea is tried again.
  const noteFailure = (kind: TurnError) => setTurnError(kind);
  const noteSuccess = () => {
    setTurnError(null);
  };

  const classify = (error: unknown): TurnError => {
    const c = errorCode(error);
    if (c === "plan_ceiling_reached" || c === "idea_cap_reached") return "ceiling";
    if (c === "assistant_unavailable" || (error as { status?: unknown })?.status === 503)
      return "unavailable";
    return "other";
  };

  const check = useCallback(async () => {
    if (!code || running) return;
    setRunning(true);
    await autosave.flush();
    try {
      await turn({ code }).unwrap();
      noteSuccess();
    } catch (error) {
      noteFailure(classify(error));
    } finally {
      setRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, running, autosave.flush, turn]);

  const outbox = useOutbox({
    target: code,
    send: async entry => {
      setRunning(true);
      try {
        await turn({
          code: entry.target,
          answer: entry.text,
          idempotencyKey: entry.idempotencyKey,
        }).unwrap();
        noteSuccess();
      } catch (error) {
        // Offline isn't the assistant failing: the answer waits on the device instead.
        if (!isOfflineError(error)) noteFailure(classify(error));
        throw error;
      } finally {
        setRunning(false);
      }
    },
  });

  // ── checks ────────────────────────────────────────────────────────────────────────────────────
  const [glow, setGlow] = useState<{ quote: string; token: number } | null>(null);
  const [glowMessage, setGlowMessage] = useState<{ id: string; token: number } | null>(null);
  const showEvidence = (c: RoadmapDraftCheck) => {
    if (!c.evidence) return;
    if (c.evidence.from === "answer" && c.evidence.messageId) {
      setGlowMessage({ id: c.evidence.messageId, token: Date.now() });
    } else {
      setGlow({ quote: c.evidence.quote, token: Date.now() });
    }
  };
  const previousChecks = useRef(draft?.checks);
  useEffect(() => {
    const before = previousChecks.current;
    previousChecks.current = draft?.checks;
    const fresh = newlyMet(before, draft?.checks);
    // Only after the first load: a check met by an earlier visit doesn't glow.
    if (fresh.length && before) {
      const fromText = fresh.find(c => c.evidence?.from === "text");
      if (fromText) setGlow({ quote: fromText.evidence!.quote, token: Date.now() });
      const fromAnswer = fresh.find(c => c.evidence?.from === "answer" && c.evidence.messageId);
      if (fromAnswer) setGlowMessage({ id: fromAnswer.evidence!.messageId!, token: Date.now() });
    }
  }, [draft?.checks]);

  const notQuite = async (c: RoadmapDraftCheck) => {
    if (!code) return;
    try {
      await reopen({ code, checkId: c.id }).unwrap();
    } catch {
      toast.error(copy.notQuiteFailed);
      return;
    }
    void check();
  };

  // ── submit ────────────────────────────────────────────────────────────────────────────────────
  const total = draft?.checksTotal ?? 5;
  const met = draft?.checksMet ?? 0;
  const complete = !!draft && met >= total;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sealed, setSealed] = useState(false);

  // "What will be submitted" (audit rec. 6). A new statement from the agent replaces the edits.
  const textMax = draft?.textMax ?? DRAFT_TEXT_MAX;
  const proposal = draft?.proposal ?? null;
  const [choice, setChoice] = useState<SubmitChoiceState>(() => initialSubmitChoice(proposal));
  const proposalKey = proposal ? `${proposal.title}\n${proposal.statement}` : "";
  useEffect(() => {
    setChoice(initialSubmitChoice(proposal));
    // Only when the agent's version itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalKey]);
  const choiceProblem = proposal ? submitChoiceProblem(choice, textMax) : null;
  // The title is required to submit (#342). When the dialog opens it is the idea agent's own title
  // if it wrote one, else a suggestion from the draft's text; whatever the author typed is never
  // overwritten by a late suggestion.
  const [title, setTitle] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const titleEdited = useRef(false);
  useEffect(() => {
    if (!confirmOpen || title.trim() || !draft?.text?.trim()) return undefined;
    if (proposal?.title) {
      setTitle(proposal.title);
      return undefined;
    }
    let live = true;
    setSuggesting(true);
    suggestTitle({ text: draft.text })
      .unwrap()
      .then(r => {
        if (live && !titleEdited.current) setTitle(r.title);
      })
      .catch(() => undefined)
      .finally(() => live && setSuggesting(false));
    return () => {
      live = false;
    };
    // Only when the dialog opens: typing must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen]);
  const titleReady = title.trim().length > 0;

  const doSubmit = async () => {
    if (!code || !draft || submitting || !titleReady) return;
    setSubmitting(true);
    await autosave.flush();
    const goalId = autosave.goalId ?? draft.suggestedGoal?.id ?? undefined;
    try {
      const result = await submit({
        code,
        title: title.trim(),
        ...(goalId ? { goalId } : {}),
        // Only a page that showed the choice sends one; with none the server files the text as is.
        ...(proposal ? { choice: toSubmitChoice(choice) } : {}),
      }).unwrap();
      jobs.complete("draft_to_submitted", { itemId: code });
      setConfirmOpen(false);
      haptic(10);
      if (result.firstSubmit) markFirstSubmit(code);
      // The private outline turns solid and the banner collapses, then the idea page takes over
      // and its tracker draws step 1 in (§4.18 "Submit", slow · expressive).
      setSealed(true);
      window.setTimeout(
        () => {
          dispatch(roadmapV2API.util.upsertQueryData("getRoadmapItem", code, result.item) as never);
        },
        reduced ? 100 : 400,
      );
    } catch (error) {
      setSubmitting(false);
      const c = errorCode(error);
      if (c === "goal_required") toast.error(copy.submitGoalNeeded);
      else if (c === "checks_incomplete") toast.error(copy.submitChecksMissing);
      else if (c === "no_statement") toast.error(copy.submitNoStatement);
      else if (c === "statement_empty") toast.error(copy.submitStatementEmpty);
      else if (c === "too_long") toast.error(copy.submitTooLong(textMax));
      else toast.error(copy.submitFailed);
    }
  };

  // ── similar, discard, restore ─────────────────────────────────────────────────────────────────
  const onAddTo = async (target: string) => {
    if (!code) return;
    try {
      await autosave.flush();
      const result = await addTo({ code, target }).unwrap();
      toast.success(result.voted ? copy.addedMyPoint(target) : copy.addedMyPointNoVote(target));
      navigate(ROUTES.ROADMAP_IDEA(result.target?.code ?? target));
    } catch {
      toast.error(copy.addMyPointFailed);
    }
  };

  const [discardOpen, setDiscardOpen] = useState(false);
  const doDiscard = async () => {
    setDiscardOpen(false);
    if (!code) {
      navigate(ROUTES.ROADMAP_DRAFTS);
      return;
    }
    try {
      await discard(code).unwrap();
      toast.success(copy.discarded);
      navigate(ROUTES.ROADMAP_DRAFTS, { replace: true });
    } catch {
      toast.error(copy.discardFailed);
    }
  };

  const doRestore = async () => {
    if (!code) return;
    try {
      await restore(code).unwrap();
    } catch {
      toast.error(copy.restoreFailed);
    }
  };

  // ── goal ──────────────────────────────────────────────────────────────────────────────────────
  const { data: goals } = useGetRoadmapProductGoalsQuery();
  const goalList = Array.isArray(goals) ? goals : [];
  const suggested = draft?.suggestedGoal;

  // ── phone chrome ──────────────────────────────────────────────────────────────────────────────
  const [checksSheet, setChecksSheet] = useState(false);
  const keyboardInset = useKeyboardInset();

  // ── render ────────────────────────────────────────────────────────────────────────────────────
  const savedLine = <SaveStatus state={autosave.status} savedAt={autosave.savedAt} />;

  const textBox = (
    <div className="flex flex-col gap-1">
      <label htmlFor={`roadmap-draft-text-${code ?? "new"}`} className="sr-only">
        {copy.textLabel}
      </label>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 rounded border border-transparent focus-within:border-primary-600">
          <HighlightedTextBox
            id={`roadmap-draft-text-${code ?? "new"}`}
            textareaRef={textRef}
            value={autosave.text}
            onChange={autosave.setText}
            glow={glow}
            minRows={isPhone ? 6 : 3}
            readOnly={readOnly}
            placeholder={copy.textPlaceholder}
            aria-describedby={`roadmap-draft-help-${code ?? "new"}`}
          />
        </div>
        {!readOnly && !isPhone && (
          <DictationButton
            code={code}
            boxLabel={copy.textLabel}
            onText={words => typeInText(autosave.text, words, autosave.setText, reduced)}
          />
        )}
      </div>
      <p
        id={`roadmap-draft-help-${code ?? "new"}`}
        className="m-0 flex justify-between gap-2 text-xs text-typography-secondary"
      >
        <span>{copy.textHelp}</span>
        {/* The one limit, shared with the capture box and with what Submit files. */}
        <span className="shrink-0 tabular-nums">
          {copy.textCount(autosave.text.length, textMax)}
        </span>
      </p>
    </div>
  );

  const goalRow = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-64 max-w-full">
        <RoadmapDropdown
          id={`roadmap-draft-goal-${code ?? "new"}`}
          labelText={`${copy.goal} ${copy.goalOptional}`}
          size="sm"
          value={autosave.goalId ?? ""}
          disabled={readOnly}
          options={[
            { value: "", label: copy.goalNone },
            ...goalList.map(g => ({ value: g.id, label: g.name })),
          ]}
          onChange={value => autosave.setGoalId(value || null)}
        />
      </div>
      {suggested && !autosave.goalId && !readOnly && (
        <span className="flex items-center gap-2 text-sm text-typography-secondary">
          {copy.goalSuggested(suggested.name)}
          <Button kind="ghost" size="sm" onClick={() => autosave.setGoalId(suggested.id)}>
            {copy.useSuggestedGoal}
          </Button>
        </span>
      )}
    </div>
  );

  const checksPanel = draft ? (
    <ChecksPanel
      draft={draft}
      met={met}
      total={total}
      readOnly={readOnly}
      checking={running}
      onCheck={() => void check()}
      onNotQuite={c => void notQuite(c)}
      onShowEvidence={c => {
        showEvidence(c);
        setChecksSheet(false);
      }}
      onSubmit={() => setConfirmOpen(true)}
      hideSubmit={isPhone}
    />
  ) : null;

  const conversation = (
    <DraftConversation
      code={code}
      messages={draft?.conversation ?? []}
      pending={outbox.pending}
      running={running}
      turnError={turnError}
      onRetryTurn={() => void check()}
      onRetrySend={outbox.retry}
      onAnswer={text => outbox.enqueue({ kind: "draftAnswer", text })}
      onCheck={() => void check()}
      readOnly={readOnly || !code}
      glowMessageId={glowMessage}
      large={isPhone}
    />
  );

  const findings = (
    <IdeaAgentFindings brief={draft?.brief ?? null} variant="live" showEmpty={!!code} />
  );

  const submitChoice =
    complete && !readOnly ? (
      <SubmitChoice
        authorText={autosave.text}
        proposal={proposal}
        max={textMax}
        value={choice}
        onChange={setChoice}
      />
    ) : null;

  const similar = (
    <SimilarIdeas
      code={code}
      text={autosave.text}
      readOnly={readOnly}
      saved={autosave.status === "saved"}
      onAddTo={onAddTo}
    />
  );

  return (
    <motion.div
      className={`relative m-2 flex min-h-0 flex-col rounded-lg border-2 ${
        sealed ? "border-solid border-border-light" : "border-dashed border-neutral-300"
      } ${isPhone ? "pb-28" : ""}`}
      transition={motionTransition("slow", "expressive", reduced)}
      aria-label={copy.pageLabel}
    >
      <AnimatePresence initial={false}>
        {!sealed && (
          <motion.header
            key="banner"
            className="flex items-center justify-between gap-2 border-b border-dashed border-neutral-300 px-4 py-2"
            exit={
              reduced ? { opacity: 0 } : { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }
            }
            transition={motionTransition("slow", "expressive", reduced)}
          >
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="m-0 flex items-center gap-2 text-sm font-semibold text-typography-primary outline-none"
            >
              <span aria-hidden>◌</span>
              {copy.privateBanner}
              {code && (
                <span className="text-xs font-normal tabular-nums text-typography-secondary">
                  {code}
                </span>
              )}
            </h1>
            <div className="flex items-center gap-2">
              {savedLine}
              {isPhone && draft && (
                <button
                  type="button"
                  onClick={() => setChecksSheet(true)}
                  className="inline-flex min-h-11 items-center rounded-full border border-border-light px-3 text-sm tabular-nums"
                  aria-label={`${copy.showChecks}: ${copy.checksCountLong(met, total)}`}
                >
                  {copy.checksCount(met, total)}
                </button>
              )}
              <OverflowMenu
                aria-label={copy.moreActions}
                iconDescription={copy.moreActions}
                flipped
                size={touch ? "lg" : "sm"}
              >
                <OverflowMenuItem
                  itemText={copy.discard}
                  isDelete
                  onClick={() => setDiscardOpen(true)}
                />
              </OverflowMenu>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {readOnly && draft?.archivedAt && (
        <div
          className="flex flex-wrap items-center gap-3 bg-neutral-50 px-4 py-2 text-sm"
          role="status"
        >
          <span>{copy.archived(shortDate(draft.archivedAt))}</span>
          <Button kind="tertiary" size="sm" onClick={() => void doRestore()}>
            {copy.restore}
          </Button>
        </div>
      )}
      {!readOnly && draft?.archiveAt && dueSoon(draft.archiveAt) && (
        <p className="m-0 bg-warning-50 px-4 py-2 text-sm text-typography-primary" role="status">
          {copy.archiveSoon(shortDate(draft.archiveAt))}
        </p>
      )}
      {autosave.conflict && (
        <p className="m-0 bg-neutral-50 px-4 py-2 text-xs text-typography-secondary" role="status">
          {copy.conflict}
        </p>
      )}

      <div className="flex flex-col gap-4 px-4 py-3">
        {textBox}
        {goalRow}
        {submitChoice}
      </div>

      {isPhone ? (
        <div className="flex flex-col gap-4 border-t border-border-light px-4 py-3">
          {conversation}
          {similar}
          {findings}
        </div>
      ) : (
        <div
          className={`grid gap-4 border-t border-border-light px-4 py-3 ${
            breakpoint === "tablet"
              ? "grid-cols-[1fr_minmax(240px,320px)]"
              : "grid-cols-[1fr_minmax(280px,360px)]"
          }`}
        >
          <div className="flex min-w-0 flex-col gap-4">
            {conversation}
            {similar}
            {findings}
          </div>
          <div className="min-w-0">{checksPanel}</div>
        </div>
      )}

      {isPhone && !readOnly && (
        <div
          className="fixed inset-x-0 z-[20] flex items-center gap-3 border-t border-border-light bg-white px-4 py-2"
          style={{
            bottom: keyboardInset,
            paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
          }}
        >
          <DictationButton
            code={code}
            large
            boxLabel={copy.textLabel}
            onText={words => typeInText(autosave.text, words, autosave.setText, reduced)}
          />
          {complete ? (
            <Button
              kind="primary"
              size="lg"
              className="flex-1 max-w-none"
              onClick={() => setConfirmOpen(true)}
            >
              {copy.submit}
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => setChecksSheet(true)}
              className="min-h-12 flex-1 rounded border border-border-light text-sm"
            >
              {copy.submitLocked(met, total)}
            </button>
          )}
        </div>
      )}

      {isPhone && (
        <BottomSheet
          open={checksSheet}
          onClose={() => setChecksSheet(false)}
          title={copy.checksTitle}
          closeLabel={en.roadmapV2.mobile.close}
        >
          {checksPanel}
        </BottomSheet>
      )}

      <RoadmapDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={copy.submitConfirmTitle}
        primaryText={copy.submitConfirm}
        onPrimary={() => void doSubmit()}
        primaryDisabled={submitting || !titleReady || !!choiceProblem}
        secondaryText={copy.submitCancel}
        sheet={touch}
        closeLabel={copy.submitCancel}
      >
        <label
          className="mb-1 block text-sm font-medium text-typography-primary"
          htmlFor="draft-title"
        >
          {copy.titleLabel}
        </label>
        <input
          id="draft-title"
          value={title}
          maxLength={200}
          required
          disabled={submitting}
          placeholder={suggesting ? copy.titleSuggesting : copy.titlePlaceholder}
          onChange={e => {
            titleEdited.current = true;
            setTitle(e.target.value.replace(/\n/g, " "));
          }}
          className="mb-1 w-full rounded border border-border-light bg-transparent px-3 py-2 text-sm text-typography-primary"
        />
        <p className="mb-3 mt-0 text-xs text-typography-secondary">
          {titleReady ? copy.titleHint : copy.titleRequired}
        </p>
        <p className="m-0 text-sm text-typography-primary">{copy.submitConfirmBody}</p>
      </RoadmapDialog>

      <RoadmapDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title={copy.discard}
        primaryText={copy.discard}
        onPrimary={() => void doDiscard()}
        secondaryText={copy.submitCancel}
        danger
        sheet={touch}
        closeLabel={copy.submitCancel}
      >
        <p className="m-0 text-sm text-typography-primary">{copy.discardConfirm}</p>
      </RoadmapDialog>
    </motion.div>
  );
};

/** "Saving…" crossfades to "Saved · 2s ago" with a small ✓ (§4.18 "Autosave", fast). */
const SaveStatus: React.FC<{
  state: ReturnType<typeof useDraftAutosave>["status"];
  savedAt: number | null;
}> = ({ state, savedAt }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.draft;
  const [, tick] = useState(0);
  useEffect(() => {
    if (state !== "saved") return undefined;
    const id = setInterval(() => tick(t => t + 1), 5000);
    return () => clearInterval(id);
  }, [state]);
  const text =
    state === "saving"
      ? copy.saving
      : state === "saved"
        ? copy.savedAgo(agoText(savedAt))
        : state === "device"
          ? copy.savedOnDevice
          : state === "error"
            ? copy.saveFailed
            : "";
  return (
    <span
      className="inline-flex min-h-5 items-center text-xs text-typography-secondary"
      aria-live="polite"
    >
      <AnimatePresence mode="wait" initial={false}>
        {text && (
          <motion.span
            key={state}
            className="inline-flex items-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransition("fast", "productive", reduced)}
          >
            {state === "saved" && <Tick size={12} aria-hidden />}
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
};

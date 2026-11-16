import React, { useEffect, useMemo, useRef, useState } from "react";

import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { TextArea } from "@ally-ui-mono/ui-shared";
import {
  useEscalateDebriefMutation,
  useGetDebriefModelsQuery,
  useGetDebriefSessionQuery,
  useResolveDebriefFlagMutation,
} from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { DebriefSessionView, ExpertComment, ExpertCommentDraftAnchor } from "@types";
import { getErrorMessage } from "@utils";

import { languageLabel, modelLabels } from "../consoleLabels";
import { TruncatedTitle } from "../consoleRows";
import { BackLink } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { selectionToAnchor } from "../expertReviewSelection";
import { FILTER_KEYS } from "../queue";
import { cardDomId, Correcting, DebriefColumn, DebriefTab } from "./DebriefColumn";
import { ReviewPanel } from "./ReviewPanel";
import { RoleplayColumn, turnDomId } from "./RoleplayColumn";
import { Decision, JumpTarget, WaitingBar } from "./WaitingBar";
import { scenarioTitle } from "../home/SessionCard";

/** How long a "Read first" jump keeps its highlight. */
const HIGHLIGHT_MS = 2500;

type Asking = { type: "keep" | "remove" | "checked"; flagId: string };

/**
 * Between Carbon’s lg breakpoint (1056px, where the header splits into two rows on purpose) and its
 * xlg (1312px) the header drops its labels: the back link and Agent logs become icons. Each label
 * stays for screen readers and as a tooltip.
 */
const COMPACT_LABEL = "min-[1056px]:max-[1311px]:sr-only";
const COMPACT_PAD = "min-[1056px]:max-[1311px]:px-2.5";

/** The facts strip (v2): who, where and in which language. No scores, cost or time. */
const Facts: React.FC<{ view: DebriefSessionView }> = ({ view }) => {
  const f = en.debriefs.session.facts;
  const rows: Array<{ k: string; v: string; sub: string }> = [
    {
      k: en.debriefs.session.learner,
      v: view.session.learner.name ?? "—",
      sub: new Date(view.run.createdAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    },
    { k: f.organisation, v: view.session.tenantName ?? "—", sub: "" },
    { k: f.language, v: languageLabel(view.run.language), sub: view.run.language ?? "" },
  ];
  return (
    <dl
      className="m-0 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] rounded-sm bg-neutral-50"
      data-testid="session-facts"
    >
      {rows.map(r => (
        <div key={r.k} className="flex flex-col gap-1 border-r border-neutral-100 px-[18px] py-3.5">
          <dt className="text-xs tracking-[.32px] text-neutral-600">{r.k}</dt>
          <dd className="m-0 text-base font-semibold text-typography-900">{r.v}</dd>
          {r.sub && <span className="text-xs text-neutral-600">{r.sub}</span>}
        </div>
      ))}
    </dl>
  );
};

/**
 * v2: nothing is held and there is no review queue. The Review pane keeps the clinical expert's
 * review: escalations, and a learner's flag a person may still change (F3: Correct it / Keep it /
 * Remove it). Held, below-the-bar and distress items are gone (distress goes to Slack, K3), and so
 * are the run decisions (Publish, Show today's debrief, Looks fine).
 */
const ESCALATIONS = new Set(["escalated_flag", "escalated_run"]);
const REVIEW_KINDS = new Set([...ESCALATIONS, "flag", "urgent_flag"]);
const RUN_DECISIONS = new Set(["publish", "todays_debrief", "looks_fine"]);
export const reviewActions = (view: DebriefSessionView): DebriefSessionView["pendingActions"] =>
  view.pendingActions
    .filter(p => REVIEW_KINDS.has(p.kind))
    .map(p => ({ ...p, decisions: p.decisions.filter(d => !RUN_DECISIONS.has(d)) }));

/** The bar above the columns: only an escalation to this viewer (no other banners). */
export const escalationsOnly = (
  pending: DebriefSessionView["pendingActions"],
): DebriefSessionView["pendingActions"] => pending.filter(p => ESCALATIONS.has(p.kind));

/**
 * One debriefed session (redesign 2026-11-12): the roleplay and the debrief side by side, what
 * waits on the viewer above them, and the Review button's panel top right. Everything comes from
 * ally-be's session view (`GET sessions/runs/:id`), which writes an audit event when opened.
 */
export const DebriefSessionPage: React.FC = () => {
  const { runId = "" } = useParams<{ runId: string }>();
  const [params] = useSearchParams();
  const s = en.debriefs.session;

  const q = useGetDebriefSessionQuery(runId, { refetchOnMountOrArgChange: true });
  const view = q.data;
  const access = useDebriefAccess(view?.viewer);
  const models = useGetDebriefModelsQuery();
  const modelLabel = modelLabels(models.data);
  const [resolve, resolving] = useResolveDebriefFlagMutation();
  const [escalate] = useEscalateDebriefMutation();

  const homeQuery = useMemo(() => {
    const out = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) out.set(k, v);
    }
    return out.toString();
  }, [params]);

  const [paneOpen, setPaneOpen] = useState(false);
  const [tab, setTab] = useState<DebriefTab>("debrief");
  const [done, setDone] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<Correcting | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [reason, setReason] = useState("");
  const [focus, setFocus] = useState<{ turns: number[]; section: string | null } | null>(null);
  const [draft, setDraft] = useState<ExpertCommentDraftAnchor | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  // A jump's highlight fades after a moment.
  useEffect(() => {
    if (!focus) return undefined;
    const t = window.setTimeout(() => setFocus(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [focus]);

  // The panel closes on a click outside it.
  useEffect(() => {
    if (!paneOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (reviewRef.current && !reviewRef.current.contains(e.target as Node)) setPaneOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [paneOpen]);

  const comments = view?.comments;
  const { roots, repliesByRoot } = useMemo(() => {
    const all = comments ?? [];
    const byRoot = new Map<string, ExpertComment[]>();
    for (const c of all) {
      if (c.parentId) byRoot.set(c.parentId, [...(byRoot.get(c.parentId) ?? []), c]);
    }
    return { roots: all.filter(c => !c.parentId), repliesByRoot: byRoot };
  }, [comments]);

  const jump = (t: JumpTarget) => {
    if (t.pane) {
      setPaneOpen(true);
      return;
    }
    if (t.askAlly) {
      setTab("ask");
      return;
    }
    if (t.section) setTab("debrief");
    setFocus({ turns: t.turns ?? [], section: t.section ?? null });
    window.setTimeout(() => {
      const el = t.turns?.length
        ? document.getElementById(turnDomId(Math.min(...t.turns)))
        : t.section
          ? document.getElementById(cardDomId(t.section))
          : null;
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }, 0);
  };

  const focusThread = (id: string) => {
    setActiveId(id);
    setPaneOpen(true);
  };

  const onSelect = () => {
    if (!view?.can.comment) return;
    const anchor = selectionToAnchor(window.getSelection());
    if (anchor) setDraft(anchor);
  };

  const escalateIt = async (flagId?: string) => {
    try {
      await escalate(flagId ? { kind: "flags", id: flagId } : { kind: "runs", id: runId }).unwrap();
      toast.success(en.debriefs.review.escalatedDone);
      setDone(s.reviewed.escalated);
      setPaneOpen(false);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.review.failed));
    }
  };

  const decide = (d: Decision) => {
    setReason("");
    if (d.decision === "correct") {
      const section =
        d.section ??
        (d.flagId ? view?.flags.find(f => f.id === d.flagId)?.section : null) ??
        "important_moment";
      setCorrecting({ flagId: d.flagId ?? null, section });
      setPaneOpen(false);
      setTab("debrief");
    } else if (d.decision === "escalate") {
      void escalateIt(d.flagId);
    } else if (d.decision === "verdict") {
      setPaneOpen(true);
    } else if (
      d.flagId &&
      (d.decision === "keep" || d.decision === "remove" || d.decision === "checked")
    ) {
      setAsking({ type: d.decision, flagId: d.flagId });
    }
  };

  const confirm = async () => {
    if (!asking) return;
    try {
      await resolve({
        id: asking.flagId,
        outcome: asking.type === "remove" ? "removed" : "kept",
        note: reason.trim() || undefined,
      }).unwrap();
      toast.success(
        asking.type === "remove" ? en.debriefs.review.removed : en.debriefs.review.kept,
      );
      setDone(
        asking.type === "remove"
          ? s.reviewed.removed
          : asking.type === "checked"
            ? s.reviewed.reviewed
            : s.reviewed.kept,
      );
      setAsking(null);
      setPaneOpen(false);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.review.failed));
    }
  };

  const backLabel = en.debriefs.title;
  const backTo = `${ROUTES.DEBRIEFS}${homeQuery ? `?${homeQuery}` : ""}`;

  if (q.isError && !view) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink to={backTo}>{backLabel}</BackLink>
        </div>
        <ErrorPanel
          forbiddenMessage={en.debriefs.noAccess}
          what={en.debriefs.run.loadFailed}
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }
  if (!view) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink to={backTo}>{backLabel}</BackLink>
        </div>
        <LoadingBlock lines={10} />
      </div>
    );
  }

  const verdict = view.verdict?.verdict;
  const reviewedWhat =
    done ??
    (verdict
      ? s.reviewed.verdict(
          verdict === "good"
            ? en.debriefs.expertReview.verdict.good
            : en.debriefs.expertReview.verdict.needsWork,
        )
      : null);
  const title = scenarioTitle(view.session.scenario.title, view.run.sessionId);
  // v2: the Review pane is the clinical expert's review; the bar shows escalations only.
  const pending = reviewActions(view);
  const reviewView: DebriefSessionView = { ...view, pendingActions: pending };
  const barView: DebriefSessionView = { ...view, pendingActions: escalationsOnly(pending) };

  return (
    <div className="flex flex-col gap-5 font-primary" data-testid="debrief-session">
      <div
        ref={reviewRef}
        className="relative flex min-w-0 flex-nowrap items-center gap-3 max-[1055px]:flex-wrap"
        data-testid="session-header"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="shrink-0">
            <BackLink to={backTo} labelClassName={COMPACT_LABEL}>
              {backLabel}
            </BackLink>
          </span>
          <TruncatedTitle
            as="h1"
            text={title}
            testId="session-title"
            className="font-secondary text-[28px] font-normal leading-tight"
          />
        </div>
        <div
          className="flex shrink-0 flex-nowrap items-center gap-3 max-[1055px]:basis-full max-[1055px]:justify-end"
          data-testid="session-actions"
        >
          {access.agentLogs && (
            <Link
              to={`${ROUTES.DEBRIEF_SESSION_LOGS(runId)}${homeQuery ? `?${homeQuery}` : ""}`}
              aria-label={s.agentLogs}
              title={s.agentLogs}
              className={`flex h-10 items-center gap-2 whitespace-nowrap rounded-sm border border-primary-500 px-3.5 text-sm font-semibold text-primary-500 no-underline hover:text-primary-600 ${COMPACT_PAD}`}
              data-testid="agent-logs-button"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M3 3h10v10H3z" />
                <path d="M5.5 6h5M5.5 8h5M5.5 10h3" />
              </svg>
              <span className={COMPACT_LABEL}>{s.agentLogs}</span>
            </Link>
          )}
          {reviewedWhat ? (
            <button
              type="button"
              aria-expanded={paneOpen}
              data-testid="review-button"
              data-reviewed="true"
              onClick={() => setPaneOpen(o => !o)}
              title={s.reviewedButton(reviewedWhat)}
              className={`flex h-10 items-center gap-2 whitespace-nowrap rounded-sm border border-success-400 bg-success-50 px-4 text-sm font-semibold text-success-600 ${COMPACT_PAD}`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M3 8.5l3 3 7-7" />
              </svg>
              <span className={COMPACT_LABEL}>{s.reviewedButton(reviewedWhat)}</span>
            </button>
          ) : (
            <button
              type="button"
              aria-expanded={paneOpen}
              data-testid="review-button"
              onClick={() => setPaneOpen(o => !o)}
              title={s.review}
              className="flex h-10 items-center gap-2 whitespace-nowrap rounded-sm bg-primary-500 px-4 text-sm font-semibold text-white min-[1056px]:max-[1311px]:px-3"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
              </svg>
              <span className={COMPACT_LABEL}>{s.review}</span>
              {pending.length > 0 && (
                <span className="rounded-full bg-white px-[7px] py-px text-xs font-semibold text-primary-500">
                  {pending.length}
                </span>
              )}
            </button>
          )}
        </div>
        {paneOpen && (
          <ReviewPanel
            view={reviewView}
            access={access}
            roots={roots}
            repliesByRoot={repliesByRoot}
            activeId={activeId}
            onFocusThread={setActiveId}
            onDecide={decide}
            onClose={() => setPaneOpen(false)}
          />
        )}
      </div>

      <Facts view={view} />

      <WaitingBar view={barView} onJump={jump} onDecide={decide} />

      <div className="flex flex-wrap items-start gap-5">
        <RoleplayColumn
          runId={runId}
          sessionId={view.run.sessionId}
          transcript={view.transcript}
          roots={roots}
          activeId={activeId}
          onFocusThread={focusThread}
          highlightTurns={focus?.turns ?? []}
          pending={draft}
          onPendingDone={() => setDraft(null)}
          onSelect={onSelect}
          canComment={view.can.comment}
        />
        <DebriefColumn
          view={view}
          tab={tab}
          onTab={setTab}
          correcting={correcting}
          onCorrectDone={() => setCorrecting(null)}
          onCorrected={() => {
            setCorrecting(null);
            setDone(s.reviewed.corrected);
          }}
          highlightSection={focus?.section ?? null}
          roots={roots}
          activeId={activeId}
          onFocusThread={focusThread}
          pending={draft}
          onPendingDone={() => setDraft(null)}
          onSelect={onSelect}
          modelLabel={modelLabel}
          onAbout={section => jump({ section })}
          onTurn={turn => jump({ turns: [turn] })}
        />
      </div>

      <ConfirmDialog
        isOpen={asking !== null}
        title={asking ? s.ask[asking.type].title : ""}
        cancelLabel={en.debriefs.review.cancel}
        confirmLabel={asking ? s.ask[asking.type].confirm : ""}
        confirmDisabled={!!asking && asking.type !== "remove" && !reason.trim()}
        danger={asking?.type === "remove"}
        isWorking={resolving.isLoading}
        onConfirm={() => void confirm()}
        onClose={() => setAsking(null)}
      >
        {asking && (
          <TextArea
            id="session-decision-reason"
            labelText={s.ask[asking.type].label}
            helperText={s.ask.learnerReads}
            rows={3}
            value={reason}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
          />
        )}
      </ConfirmDialog>
    </div>
  );
};

export default DebriefSessionPage;

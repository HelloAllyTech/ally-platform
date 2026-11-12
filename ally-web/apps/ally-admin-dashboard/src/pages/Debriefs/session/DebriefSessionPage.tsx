import React, { useEffect, useMemo, useRef, useState } from "react";

import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { TextArea } from "@ally-ui-mono/ui-shared";
import {
  useActOnDebriefRunMutation,
  useEscalateDebriefMutation,
  useGetDebriefModelsQuery,
  useGetDebriefSessionQuery,
  useResolveDebriefFlagMutation,
} from "@api";
import { formatUsd, releaseVersionLabel, shortId } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { DebriefSessionView, ExpertComment, ExpertCommentDraftAnchor } from "@types";
import { getErrorMessage } from "@utils";

import { languageLabel, modelLabels, recipeLabel } from "../consoleLabels";
import { score } from "../consoleTable";
import { BackLink, ConsoleTag } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { selectionToAnchor } from "../expertReviewSelection";
import { JUDGE_BAR, scenarioTitle, statusOf } from "../home/SessionCard";
import { FILTER_KEYS, HOME_CATEGORIES, HomeCategory } from "../queue";
import { cardDomId, Correcting, DebriefColumn, DebriefTab } from "./DebriefColumn";
import { ReviewPanel } from "./ReviewPanel";
import { RoleplayColumn, turnDomId } from "./RoleplayColumn";
import { Decision, JumpTarget, WaitingBar } from "./WaitingBar";

/** How long a "Read first" jump keeps its highlight. */
const HIGHLIGHT_MS = 2500;

type Asking =
  | { type: "keep" | "remove" | "checked"; flagId: string }
  | { type: "publish" | "todays-debrief" | "reviewed"; runId: string };

const RUN_ACTION: Partial<Record<Decision["decision"], "publish" | "todays-debrief" | "reviewed">> =
  {
    publish: "publish",
    todays_debrief: "todays-debrief",
    looks_fine: "reviewed",
  };

const isTyping = (e: KeyboardEvent) => {
  const t = e.target;
  return (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable)
  );
};

const Facts: React.FC<{ view: DebriefSessionView }> = ({ view }) => {
  const f = en.debriefs.session.facts;
  const how = view.howItWasMade;
  const judge = view.judge.hidden ? null : (view.judge.overall ?? null);
  const rows: Array<{ k: string; v: string; sub: string; warn?: boolean }> = [
    {
      k: f.session,
      v: shortId(view.run.sessionId),
      sub: new Date(view.run.createdAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    },
    {
      k: f.organisation,
      v: view.session.tenantName ?? "—",
      sub: view.session.learner.name ?? "",
    },
    { k: f.recipe, v: recipeLabel(view.run.recipe), sub: en.debriefs.mode[view.run.mode] ?? "" },
    { k: f.language, v: languageLabel(view.run.language), sub: view.run.language ?? "" },
    {
      k: f.judge,
      v: view.judge.hidden ? f.hidden : judge === null ? "—" : f.outOf10(score(judge)),
      sub: view.judge.hidden ? f.hiddenSub : f.bar(JUDGE_BAR),
      warn: judge !== null && judge < JUDGE_BAR,
    },
    {
      k: f.evaluator,
      v:
        view.judge.hidden || view.judge.evaluatorOverall == null
          ? "—"
          : f.outOf10(score(view.judge.evaluatorOverall)),
      sub: f.revisions(how.revisionRounds),
    },
    {
      k: f.cost,
      v: formatUsd(how.actualCostUsd ?? how.estimatedCostUsd),
      sub: how.ceilingUsd != null ? f.ceiling(formatUsd(how.ceilingUsd)) : "",
    },
    { k: f.time, v: how.seconds === null ? "—" : `${how.seconds} s`, sub: "" },
    {
      k: f.release,
      v: view.run.releaseVersion != null ? releaseVersionLabel(view.run.releaseVersion) : "—",
      sub: "",
    },
  ];
  return (
    <dl
      className="m-0 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] rounded-sm bg-neutral-50"
      data-testid="session-facts"
    >
      {rows.map(r => (
        <div key={r.k} className="flex flex-col gap-1 border-r border-neutral-100 px-[18px] py-3.5">
          <dt className="text-xs tracking-[.32px] text-neutral-600">{r.k}</dt>
          <dd
            className={`m-0 text-base font-semibold ${r.warn ? "text-[#8A3800]" : "text-typography-900"}`}
          >
            {r.v}
          </dd>
          {r.sub && <span className="text-xs text-neutral-600">{r.sub}</span>}
        </div>
      ))}
    </dl>
  );
};

/**
 * One debriefed session (redesign 2026-11-12): the roleplay and the debrief side by side, what
 * waits on the viewer above them, and the Review button's panel top right. Everything comes from
 * ally-be's session view (`GET sessions/runs/:id`), which writes an audit event when opened.
 */
export const DebriefSessionPage: React.FC = () => {
  const { runId = "" } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const s = en.debriefs.session;

  const q = useGetDebriefSessionQuery(runId, { refetchOnMountOrArgChange: true });
  const view = q.data;
  const access = useDebriefAccess(view?.viewer);
  const models = useGetDebriefModelsQuery();
  const modelLabel = modelLabels(models.data);
  const [act, acting] = useActOnDebriefRunMutation();
  const [resolve, resolving] = useResolveDebriefFlagMutation();
  const [escalate] = useEscalateDebriefMutation();

  const rawCat = params.get("cat") as HomeCategory | null;
  const cat: HomeCategory =
    rawCat && (HOME_CATEGORIES as readonly string[]).includes(rawCat) ? rawCat : "needs";
  const homeQuery = useMemo(() => {
    const out = new URLSearchParams();
    for (const k of ["cat", ...FILTER_KEYS]) {
      const v = params.get(k);
      if (v) out.set(k, v);
    }
    return out.toString();
  }, [params]);
  const linkTo = (id: string) => `${ROUTES.DEBRIEF_SESSION(id)}${homeQuery ? `?${homeQuery}` : ""}`;

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
    const runAction = RUN_ACTION[d.decision];
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
    } else if (runAction) {
      setAsking({ type: runAction, runId });
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
      if ("flagId" in asking) {
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
      } else {
        await act({ id: asking.runId, action: asking.type }).unwrap();
        toast.success(en.debriefs.review.done);
        setDone(asking.type === "publish" ? s.reviewed.published : s.reviewed[asking.type]);
      }
      setAsking(null);
      setPaneOpen(false);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.review.failed));
    }
  };

  // Next / Previous by j / k (the queue's order); e escalates what is waiting (the Ally team only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!view || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || asking || draft) return;
      if (e.key === "j" && view.queue.nextRunId) {
        e.preventDefault();
        navigate(linkTo(view.queue.nextRunId));
      } else if (e.key === "k" && view.queue.previousRunId) {
        e.preventDefault();
        navigate(linkTo(view.queue.previousRunId));
      } else if (e.key === "e") {
        const first = view.pendingActions.find(p => p.decisions.includes("escalate"));
        if (!first) return;
        e.preventDefault();
        void escalateIt(first.flagId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const backLabel = en.debriefs.home.categories[cat];
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
  const st = statusOf({ status: view.run.status });
  const urgent = view.pendingActions.some(p => p.kind === "urgent_flag");
  const askingFlag = asking && "flagId" in asking;

  return (
    <div className="flex flex-col gap-5 font-primary" data-testid="debrief-session">
      <div className="relative flex flex-wrap items-center gap-3" ref={reviewRef}>
        <BackLink to={backTo}>{backLabel}</BackLink>
        <h1 className="font-secondary text-[28px] font-normal leading-tight">
          {scenarioTitle(view.session.scenario.title, view.run.sessionId)}
        </h1>
        <ConsoleTag tone={st.tone}>{st.label}</ConsoleTag>
        {urgent && <ConsoleTag tone="urgent">{en.debriefs.home.urgent}</ConsoleTag>}
        {view.run.hasRiskCue && (
          <ConsoleTag tone="info">{en.debriefs.home.importantMoment}</ConsoleTag>
        )}
        <div className="flex-1" />
        {view.queue.position !== null && (
          <span className="text-[13px] text-neutral-600" data-testid="queue-position">
            {s.position(view.queue.position, view.queue.total, s.theQueue)}
          </span>
        )}
        {view.queue.previousRunId && (
          <Link
            to={linkTo(view.queue.previousRunId)}
            className="flex h-9 items-center px-2 text-sm no-underline"
            data-testid="session-prev"
          >
            {s.previous}
          </Link>
        )}
        {view.queue.nextRunId && (
          <Link
            to={linkTo(view.queue.nextRunId)}
            className="flex h-9 items-center px-2 text-sm no-underline"
            data-testid="session-next"
          >
            {s.next}
          </Link>
        )}
        {reviewedWhat ? (
          <button
            type="button"
            aria-expanded={paneOpen}
            data-testid="review-button"
            data-reviewed="true"
            onClick={() => setPaneOpen(o => !o)}
            className="flex h-10 items-center gap-2 rounded-sm border border-success-400 bg-success-50 px-4 text-sm font-semibold text-success-600"
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
            {s.reviewedButton(reviewedWhat)}
          </button>
        ) : (
          <button
            type="button"
            aria-expanded={paneOpen}
            data-testid="review-button"
            onClick={() => setPaneOpen(o => !o)}
            className="flex h-10 items-center gap-2 rounded-sm bg-primary-500 px-4 text-sm font-semibold text-white"
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
            {s.review}
            {view.pendingActions.length > 0 && (
              <span className="rounded-full bg-white px-[7px] py-px text-xs font-semibold text-primary-500">
                {view.pendingActions.length}
              </span>
            )}
          </button>
        )}
        {paneOpen && (
          <ReviewPanel
            view={view}
            access={access}
            roots={roots}
            repliesByRoot={repliesByRoot}
            activeId={activeId}
            onFocusThread={setActiveId}
            onDecide={decide}
            onClose={() => setPaneOpen(false)}
            onScored={() => setDone(s.reviewed.scored)}
          />
        )}
      </div>

      <Facts view={view} />

      <WaitingBar view={view} onJump={jump} onDecide={decide} />

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
        />
      </div>

      <ConfirmDialog
        isOpen={asking !== null}
        title={
          asking
            ? "flagId" in asking
              ? s.ask[asking.type].title
              : en.debriefs.review.confirmTitle[asking.type]
            : ""
        }
        cancelLabel={en.debriefs.review.cancel}
        confirmLabel={
          asking
            ? "flagId" in asking
              ? s.ask[asking.type].confirm
              : en.debriefs.review.confirmLabel[asking.type]
            : ""
        }
        confirmDisabled={!!askingFlag && asking?.type !== "remove" && !reason.trim()}
        danger={asking?.type === "remove"}
        isWorking={acting.isLoading || resolving.isLoading}
        onConfirm={() => void confirm()}
        onClose={() => setAsking(null)}
      >
        {asking && "flagId" in asking ? (
          <TextArea
            id="session-decision-reason"
            labelText={s.ask[asking.type].label}
            helperText={s.ask.learnerReads}
            rows={3}
            value={reason}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
          />
        ) : (
          <p>{asking ? en.debriefs.review.confirmBody[asking.type] : ""}</p>
        )}
      </ConfirmDialog>
    </div>
  );
};

export default DebriefSessionPage;

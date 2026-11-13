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
import { TruncatedTitle } from "../consoleRows";
import { score } from "../consoleTable";
import { BackLink, ConsoleTag, TagTone } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { selectionToAnchor } from "../expertReviewSelection";
import { FILTER_KEYS, HOME_CATEGORIES, HomeCategory } from "../queue";
import { cardDomId, Correcting, DebriefColumn, DebriefTab } from "./DebriefColumn";
import { ReviewPanel } from "./ReviewPanel";
import { RoleplayColumn, turnDomId } from "./RoleplayColumn";
import { Decision, JumpTarget, WaitingBar } from "./WaitingBar";
import { JUDGE_BAR, scenarioTitle, statusOf } from "../home/SessionCard";

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

/** One of the queue's icon-only buttons: the keyboard shortcut is in its tooltip. */
/**
 * Between Carbon’s lg breakpoint (1056px, where the header splits into two
 * rows on purpose) and its xlg (1312px) the header is one row with the least room for
 * the title, so the header drops its labels: the back link, Agent logs and
 * Reviewed become icons, Review keeps its count, and the queue position moves
 * into the queue's tooltip. Each label stays for screen readers and as a tooltip.
 */
const COMPACT_LABEL = "min-[1056px]:max-[1311px]:sr-only";
const COMPACT_PAD = "min-[1056px]:max-[1311px]:px-2.5";

const QueueButton: React.FC<{
  to: string | null;
  label: string;
  hint: string;
  testId: string;
  direction: "previous" | "next";
}> = ({ to, label, hint, testId, direction }) => {
  const icon = (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d={direction === "previous" ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"} />
    </svg>
  );
  const cls =
    "flex h-8 w-8 items-center justify-center rounded-sm border border-neutral-300 no-underline";
  return to ? (
    <Link
      to={to}
      aria-label={label}
      title={hint}
      className={`${cls} text-primary-500 hover:bg-neutral-50`}
      data-testid={testId}
    >
      {icon}
    </Link>
  ) : (
    <button
      type="button"
      disabled
      aria-label={label}
      title={hint}
      className={`${cls} cursor-not-allowed bg-transparent text-neutral-400`}
      data-testid={testId}
    >
      {icon}
    </button>
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
      sub: view.run.arm ? (f.arm[view.run.arm] ?? "") : "",
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

  // Next / Previous by J / K (the queue's order, named in the buttons' tooltips); e escalates what is waiting (the Ally team only).
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
  const title = scenarioTitle(view.session.scenario.title, view.run.sessionId);
  // At most two tags (Urgent first, then the status); the rest behind "+N".
  const tags: Array<{ label: string; tone: TagTone }> = [
    ...(urgent ? [{ label: en.debriefs.home.urgent, tone: "urgent" as TagTone }] : []),
    { label: st.label, tone: st.tone },
    ...(view.run.hasRiskCue
      ? [{ label: en.debriefs.home.importantMoment, tone: "info" as TagTone }]
      : []),
  ];
  const shownTags = tags.slice(0, 2);
  const moreTags = tags.slice(2);
  const askingFlag = asking && "flagId" in asking;

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
          {shownTags.map(t => (
            <ConsoleTag key={t.label} tone={t.tone}>
              {t.label}
            </ConsoleTag>
          ))}
          {moreTags.length > 0 && (
            <ConsoleTag
              tone="neutral"
              title={moreTags.map(t => t.label).join(", ")}
              testId="more-tags"
            >
              {s.moreTags(moreTags.length)}
            </ConsoleTag>
          )}
        </div>
        <div
          className="flex shrink-0 flex-nowrap items-center gap-3 max-[1055px]:basis-full max-[1055px]:justify-end"
          data-testid="session-actions"
        >
          {(view.queue.position !== null || view.queue.previousRunId || view.queue.nextRunId) && (
            <div
              role="group"
              aria-label={s.queue}
              title={
                view.queue.position !== null
                  ? s.queuePosition(view.queue.position, view.queue.total)
                  : undefined
              }
              className="flex items-center gap-1.5 whitespace-nowrap"
            >
              <QueueButton
                to={view.queue.previousRunId ? linkTo(view.queue.previousRunId) : null}
                label={s.previous}
                hint={s.previousHint}
                testId="session-prev"
                direction="previous"
              />
              {view.queue.position !== null && (
                <span
                  className={`text-[13px] text-neutral-600 ${COMPACT_LABEL}`}
                  data-testid="queue-position"
                >
                  {s.queuePosition(view.queue.position, view.queue.total)}
                </span>
              )}
              <QueueButton
                to={view.queue.nextRunId ? linkTo(view.queue.nextRunId) : null}
                label={s.next}
                hint={s.nextHint}
                testId="session-next"
                direction="next"
              />
            </div>
          )}
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
              {view.pendingActions.length > 0 && (
                <span className="rounded-full bg-white px-[7px] py-px text-xs font-semibold text-primary-500">
                  {view.pendingActions.length}
                </span>
              )}
            </button>
          )}
        </div>
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
          onTurn={turn => jump({ turns: [turn] })}
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

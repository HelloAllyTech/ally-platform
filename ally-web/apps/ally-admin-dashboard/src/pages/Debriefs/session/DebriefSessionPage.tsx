import React, { useEffect, useMemo, useRef, useState } from "react";

import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { TextArea } from "@ally-ui-mono/ui-shared";
import {
  useActOnDebriefRunMutation,
  useEscalateDebriefMutation,
  useGetDebriefCalibrationSampleQuery,
  useGetDebriefModelsQuery,
  useGetDebriefOverviewQuery,
  useGetDebriefRunQuery,
  useGetDebriefSettingsQuery,
  useGetExpertReviewQuery,
  useResolveDebriefFlagMutation,
} from "@api";
import { formatUsd, releaseVersionLabel, shortId } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { DebriefRunDetail, ExpertComment, ExpertCommentDraftAnchor } from "@types";
import { getErrorMessage } from "@utils";

import { languageLabel, modelLabels, recipeLabel } from "../consoleLabels";
import { score } from "../consoleTable";
import { BackLink, ConsoleTag } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { selectionToAnchor } from "../expertReviewSelection";
import { useSessionItems } from "../home/DebriefsHome";
import { JUDGE_BAR, scenarioTitle, statusLabel, statusTone } from "../home/SessionCard";
import { categoryList, FILTER_KEYS, readHomeState, SessionItem } from "../queue";
import { cardDomId, DebriefColumn, DebriefTab } from "./DebriefColumn";
import { DEFAULT_REVIEW_HOURS, pendingFor } from "./pendingActions";
import { ReviewPanel } from "./ReviewPanel";
import { RoleplayColumn, turnDomId } from "./RoleplayColumn";
import { Decision, JumpTarget, WaitingBar } from "./WaitingBar";

/** How long a "Read first" jump keeps its highlight. */
const HIGHLIGHT_MS = 2500;

type Asking =
  | { type: "keep" | "remove"; flagId: string }
  | { type: "publish" | "todays-debrief" | "reviewed"; runId: string };

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable)
  );
};

const Facts: React.FC<{
  run: DebriefRunDetail;
  item: SessionItem | undefined;
  ceiling?: number;
}> = ({ run, item, ceiling }) => {
  const f = en.debriefs.session.facts;
  const judge = item?.judge ?? run.workspace?.judge?.overall ?? null;
  const created = run.createdAt ?? item?.createdAt;
  const seconds = run.seconds ?? item?.seconds ?? null;
  const rows: Array<{ k: string; v: string; sub: string; warn?: boolean }> = [
    {
      k: f.session,
      v: shortId(run.scenarioSessionId),
      sub: created
        ? new Date(created).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "",
    },
    { k: f.organisation, v: run.tenantName ?? item?.tenantName ?? "—", sub: "" },
    { k: f.recipe, v: recipeLabel(run.recipeKey), sub: en.debriefs.mode[run.mode] ?? "" },
    { k: f.language, v: languageLabel(run.language), sub: run.language ?? "" },
    {
      k: f.judge,
      v: judge === null ? "—" : f.outOf10(score(judge)),
      sub: f.bar(JUDGE_BAR),
      warn: judge !== null && Number(judge) < JUDGE_BAR,
    },
    {
      k: f.evaluator,
      v: run.evaluatorOverall === null ? "—" : f.outOf10(score(run.evaluatorOverall)),
      sub: f.revisions(run.revisionRounds),
    },
    {
      k: f.cost,
      v: formatUsd(run.actualCostUsd ?? run.estimatedCostUsd),
      sub:
        run.ceilingUsd != null || ceiling != null
          ? f.ceiling(formatUsd(run.ceilingUsd ?? ceiling))
          : "",
    },
    { k: f.time, v: seconds === null ? "—" : `${seconds} s`, sub: "" },
    {
      k: f.release,
      v: run.releaseVersion != null ? releaseVersionLabel(run.releaseVersion) : "—",
      sub: run.arm ? f.arm[run.arm] : "",
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
 * waits on the viewer above them, and the Review button's panel top right. Opening it writes an
 * audit event on the server, as the run view always has.
 */
export const DebriefSessionPage: React.FC = () => {
  const { runId = "" } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const s = en.debriefs.session;

  const runQ = useGetDebriefRunQuery(runId, { refetchOnMountOrArgChange: true });
  const run = runQ.data;
  const access = useDebriefAccess();
  const canComment = run?.canComment ?? access.comment;
  const detailQ = useGetExpertReviewQuery(runId, { refetchOnMountOrArgChange: true });
  const detail = detailQ.data;
  const { items } = useSessionItems(access.score);
  const sample = useGetDebriefCalibrationSampleQuery(undefined, { skip: !access.score });
  const settings = useGetDebriefSettingsQuery(undefined, { skip: !access.decideHeld });
  const overview = useGetDebriefOverviewQuery();
  const models = useGetDebriefModelsQuery();
  const modelLabel = modelLabels(models.data);
  const [act, acting] = useActOnDebriefRunMutation();
  const [resolve, resolving] = useResolveDebriefFlagMutation();
  const [escalate] = useEscalateDebriefMutation();

  const { cat, filters } = readHomeState(params, access.score);
  const ceiling = overview.data?.budget.runCeilingUsd;
  const queue = useMemo(
    () => categoryList(items, cat, filters, ceiling),
    [items, cat, filters, ceiling],
  );
  const item = items.find(i => i.runId === runId);
  const index = queue.findIndex(i => i.runId === runId);
  const homeQuery = useMemo(() => {
    const q = new URLSearchParams();
    for (const k of ["cat", ...FILTER_KEYS]) {
      const v = params.get(k);
      if (v) q.set(k, v);
    }
    return q.toString();
  }, [params]);
  const linkTo = (id: string) => `${ROUTES.DEBRIEF_SESSION(id)}${homeQuery ? `?${homeQuery}` : ""}`;
  const prev = index > 0 ? queue[index - 1] : undefined;
  const next = index >= 0 && index < queue.length - 1 ? queue[index + 1] : undefined;

  const reviewHours = Number(settings.data?.values.flagReviewSlaHours ?? DEFAULT_REVIEW_HOURS);
  const pending = useMemo(
    () => pendingFor(access, run, item?.flags ?? [], item?.review ?? null, reviewHours),
    [access, run, item, reviewHours],
  );

  const [paneOpen, setPaneOpen] = useState(false);
  const [tab, setTab] = useState<DebriefTab>("debrief");
  const [done, setDone] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
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

  const comments = detail?.comments;
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
    if (!canComment) return;
    const anchor = selectionToAnchor(window.getSelection());
    if (anchor) setDraft(anchor);
  };

  const escalateIt = async (kind: "flags" | "runs", id: string) => {
    try {
      await escalate({ kind, id }).unwrap();
      toast.success(en.debriefs.review.escalatedDone);
      setDone(s.reviewed.escalated);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.review.failed));
    }
  };

  const decide = (d: Decision) => {
    setReason("");
    if (d.type === "correct") {
      setCorrecting(d.flagId);
      setPaneOpen(false);
      setTab("debrief");
    } else if (d.type === "escalate") {
      void escalateIt(d.kind, d.id);
    } else if (d.type === "verdict") {
      setPaneOpen(true);
    } else if ("runId" in d) {
      setAsking({ type: d.type, runId: d.runId });
    } else {
      setAsking({ type: d.type, flagId: d.flagId });
    }
  };

  const confirm = async () => {
    if (!asking) return;
    try {
      if ("flagId" in asking) {
        await resolve({
          id: asking.flagId,
          outcome: asking.type === "keep" ? "kept" : "removed",
          note: reason.trim() || undefined,
        }).unwrap();
        toast.success(
          asking.type === "keep" ? en.debriefs.review.kept : en.debriefs.review.removed,
        );
        setDone(asking.type === "keep" ? s.reviewed.kept : s.reviewed.removed);
      } else {
        await act({ id: asking.runId, action: asking.type }).unwrap();
        toast.success(en.debriefs.review.done);
        setDone(s.reviewed[asking.type]);
      }
      setAsking(null);
      setPaneOpen(false);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.review.failed));
    }
  };

  // Next / Previous by j / k; e escalates the first thing waiting (the Ally team only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || asking || draft) return;
      if (e.key === "j" && next) {
        e.preventDefault();
        navigate(linkTo(next.runId));
      } else if (e.key === "k" && prev) {
        e.preventDefault();
        navigate(linkTo(prev.runId));
      } else if (e.key === "e" && access.escalate) {
        const first = pending.find(p =>
          p.flag ? p.flag.status !== "escalated" : !p.review?.escalation,
        );
        if (!first) return;
        e.preventDefault();
        void escalateIt(first.flag ? "flags" : "runs", first.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The panel closes on a click outside it.
  useEffect(() => {
    if (!paneOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (reviewRef.current && !reviewRef.current.contains(e.target as Node)) setPaneOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [paneOpen]);

  const backLabel = en.debriefs.home.categories[cat];
  const backTo = `${ROUTES.DEBRIEFS}${homeQuery ? `?${homeQuery}` : ""}`;

  if (runQ.isError) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink to={backTo}>{backLabel}</BackLink>
        </div>
        <ErrorPanel
          what={en.debriefs.run.loadFailed}
          error={runQ.error}
          onRetry={() => void runQ.refetch()}
        />
      </div>
    );
  }
  if (!run) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink to={backTo}>{backLabel}</BackLink>
        </div>
        <LoadingBlock lines={10} />
      </div>
    );
  }

  const inSample = (sample.data?.items ?? []).some(
    i => i.scenarioSessionId === run.scenarioSessionId,
  );
  const verdict = detail?.myReview?.verdict;
  const reviewedWhat =
    done ??
    (verdict
      ? s.reviewed.verdict(
          verdict === "good"
            ? en.debriefs.expertReview.verdict.good
            : en.debriefs.expertReview.verdict.needsWork,
        )
      : null);
  const title = scenarioTitle({
    scenarioName: run.scenarioName ?? item?.scenarioName ?? null,
    sessionId: run.scenarioSessionId,
  });
  const askingKeep = asking?.type === "keep";

  return (
    <div className="flex flex-col gap-5 font-primary" data-testid="debrief-session">
      <div className="relative flex flex-wrap items-center gap-3" ref={reviewRef}>
        <BackLink to={backTo}>{backLabel}</BackLink>
        <h1 className="font-secondary text-[28px] font-normal leading-tight">{title}</h1>
        {item && <ConsoleTag tone={statusTone(item)}>{statusLabel(item)}</ConsoleTag>}
        {item?.urgent && <ConsoleTag tone="urgent">{en.debriefs.home.urgent}</ConsoleTag>}
        {(item?.hasRiskCue || run.hasRiskCue) && (
          <ConsoleTag tone="info">{en.debriefs.home.importantMoment}</ConsoleTag>
        )}
        <div className="flex-1" />
        {index >= 0 && (
          <span className="text-[13px] text-neutral-600" data-testid="queue-position">
            {s.position(index + 1, queue.length, cat === "needs" ? s.theQueue : backLabel)}
          </span>
        )}
        {prev && (
          <Link
            to={linkTo(prev.runId)}
            className="flex h-9 items-center px-2 text-sm no-underline"
            data-testid="session-prev"
          >
            {s.previous}
          </Link>
        )}
        {next && (
          <Link
            to={linkTo(next.runId)}
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
            {pending.length > 0 && (
              <span className="rounded-full bg-white px-[7px] py-px text-xs font-semibold text-primary-500">
                {pending.length}
              </span>
            )}
          </button>
        )}
        {paneOpen && (
          <ReviewPanel
            access={access}
            canComment={canComment}
            items={pending}
            detail={detail}
            roots={roots}
            repliesByRoot={repliesByRoot}
            activeId={activeId}
            onFocusThread={setActiveId}
            onDecide={decide}
            onClose={() => setPaneOpen(false)}
            inSample={inSample}
            sessionId={run.scenarioSessionId}
            onScored={() => setDone(s.reviewed.scored)}
          />
        )}
      </div>

      <Facts run={run} item={item} ceiling={ceiling} />

      <WaitingBar items={pending} access={access} onJump={jump} onDecide={decide} />

      <div className="flex flex-wrap items-start gap-5">
        <RoleplayColumn
          runId={runId}
          sessionId={run.scenarioSessionId}
          detail={detail}
          failed={detailQ.isError}
          loading={detailQ.isLoading}
          roots={roots}
          activeId={activeId}
          onFocusThread={focusThread}
          highlightTurns={focus?.turns ?? []}
          pending={draft}
          onPendingDone={() => setDraft(null)}
          onSelect={onSelect}
          canComment={canComment}
        />
        <DebriefColumn
          run={run}
          detail={detail}
          tab={tab}
          onTab={setTab}
          flags={item?.flags ?? []}
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
          canComment={canComment}
          modelLabel={modelLabel}
          learnerDistress={!!(run.learnerDistress ?? item?.learnerDistress)}
          onAbout={section => jump({ section })}
        />
      </div>

      <ConfirmDialog
        isOpen={asking !== null}
        title={
          asking
            ? asking.type === "keep" || asking.type === "remove"
              ? s.ask[asking.type].title
              : en.debriefs.review.confirmTitle[asking.type]
            : ""
        }
        cancelLabel={en.debriefs.review.cancel}
        confirmLabel={
          asking
            ? asking.type === "keep" || asking.type === "remove"
              ? s.ask[asking.type].confirm
              : en.debriefs.review.confirmLabel[asking.type]
            : ""
        }
        confirmDisabled={askingKeep && !reason.trim()}
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

import React, { useState } from "react";

import { toast } from "sonner";

import { useDecideIdeaMutation, useGetDebriefSettingsQuery } from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { DebriefOverview, PmAgentAutonomy, PmAgentIdeaRow, PmAgentState } from "@types";
import { getErrorMessage } from "@utils";

import { codeWords, inWords } from "../consoleLabels";
import { formatWhen } from "../consoleTable";
import { AlertBanner } from "../consoleUi";
import { DebriefAccess } from "../debriefAccess";
import { waitedFor } from "../queue";
import { IdeaCard, ideaCode } from "./IdeaCard";
import {
  daysLeft,
  EXPIRY_WARNING_DAYS,
  IDEA_GROUPS,
  ideaGroup,
  IdeaGroup,
  recentlyReverted,
  stage,
} from "./ideaGroups";

const GROUP_DOT: Record<IdeaGroup, string> = {
  needs: "bg-primary-500",
  canary: "bg-success-400",
  testing: "bg-neutral-400",
  live: "bg-success-600",
  dropped: "bg-neutral-200",
};

const ideaMeta = (idea: PmAgentIdeaRow) => {
  const p = en.debriefs.pmPage;
  const s = en.debriefs.pmAgent;
  const kind =
    p.kinds[idea.change.ideaKind] ??
    s.kinds[idea.change.ideaKind] ??
    codeWords(idea.change.ideaKind);
  if (idea.expired) return `${kind} · ${p.expiredNoDecision}`;
  const c = idea.evidence.canary;
  if (c) return `${p.canaryMeta(s.canaryStatus[c.status] ?? c.status, c.canaryRuns ?? 0)}`;
  if (idea.evidence.trial?.status === "passed") return `${kind} · ${p.passedTrial}`;
  if (idea.evidence.gate?.status === "running") return `${kind} · ${p.gateRunning}`;
  return kind;
};

const AUTONOMY_ON = new Set(["alone"]);

/** "Acts on its own for": one chip per kind of change, read-only (Settings changes them). */
const AutonomyChips: React.FC<{ autonomy: PmAgentAutonomy[] }> = ({ autonomy }) => {
  const p = en.debriefs.pmPage;
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-8 py-2.5 text-[13px]"
      data-testid="autonomy-chips"
    >
      <span className="mr-1 text-neutral-600">{p.actsAlone}</span>
      {autonomy.map(a => (
        <span
          key={a.kind}
          title={a.reason ?? undefined}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] font-semibold ${AUTONOMY_ON.has(a.state) ? "bg-success-50 text-success-600" : "bg-[#FFF2E8] text-[#8A3800]"}`}
        >
          {p.autonomyKinds[a.kind]}: {p.autonomyStates[a.state]}
        </span>
      ))}
    </div>
  );
};

/** PM agent › Ideas: the grouped list on the left, the idea in focus on the right. */
export const IdeasView: React.FC<{
  state: PmAgentState;
  overview: DebriefOverview | undefined;
  access: DebriefAccess;
  focusId: string | null;
  onFocus: (id: string) => void;
}> = ({ state, overview, access, focusId, onFocus }) => {
  const p = en.debriefs.pmPage;
  const s = en.debriefs.pmAgent;
  const settings = useGetDebriefSettingsQuery();
  const [decide, { isLoading: deciding }] = useDecideIdeaMutation();
  const [pending, setPending] = useState<{ id: string; decision: "approve" | "reject" } | null>(
    null,
  );
  const ideas = state.ideas;
  const grouped = Object.fromEntries(
    IDEA_GROUPS.map(g => [g, ideas.filter(i => ideaGroup(i, access) === g)]),
  ) as Record<IdeaGroup, PmAgentIdeaRow[]>;
  const needs = [...grouped.needs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  grouped.needs = needs;
  const focus =
    ideas.find(i => i.id === focusId) ??
    needs[0] ??
    grouped.canary[0] ??
    grouped.testing[0] ??
    ideas[0];
  const needIndex = focus ? needs.findIndex(i => i.id === focus.id) : -1;
  const expiring =
    access.pmAgent || access.approvePinnedRule
      ? needs.find(i => {
          const d = daysLeft(i);
          return d !== null && d <= EXPIRY_WARNING_DAYS;
        })
      : undefined;
  const reverted = access.pmAgent ? recentlyReverted(ideas) : [];
  const autonomy = state.autonomy ?? settings.data?.autonomy;
  const canaryShare = settings.data?.values.canaryShare as number | undefined;

  const pendingIdea = pending ? ideas.find(i => i.id === pending.id) : undefined;
  const pendingStage = pendingIdea ? stage(pendingIdea) : null;
  const handoffKind = pendingIdea?.evidence.handoff?.kind;
  const pinned = pendingIdea?.change.ideaKind === "pinned_rule";
  const approveText = (k: "title" | "body") =>
    pinned
      ? p.pinned[k]
      : pendingStage === "handoff" && handoffKind
        ? s.handoff[k][handoffKind]
        : pendingStage === "promote"
          ? k === "title"
            ? s.promoteTitle
            : s.promoteBody
          : k === "title"
            ? s.canaryTitle
            : s.canaryBody;
  const confirm = async () => {
    if (!pending) return;
    try {
      await decide(pending).unwrap();
      toast.success(
        pending.decision === "reject"
          ? s.rejected
          : pinned
            ? p.pinned.done
            : pendingStage === "handoff" && handoffKind
              ? s.handoff.done[handoffKind]
              : pendingStage === "promote"
                ? s.promoted
                : s.canaryStarted,
      );
      setPending(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s.actionFailed));
    }
  };

  const oldestNeed = needs[0];
  return (
    <>
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-neutral-50 px-8 py-3 text-sm text-neutral-700"
        data-testid="pm-strip"
      >
        {(access.pmAgent || access.approvePinnedRule) && (
          <span>
            <b className="text-typography-900">{p.needYou(needs.length)}</b>
            {oldestNeed ? ` · ${p.oldest(waitedFor(oldestNeed.createdAt))}` : ""}
          </span>
        )}
        <span>{p.inCanary(grouped.canary.length)}</span>
        <span>{p.beingTested(grouped.testing.length)}</span>
        {overview && (
          <span>
            {p.learningBudget}{" "}
            <b className="text-typography-900">{formatUsd(overview.budget.learningSpentUsd)}</b>{" "}
            {p.ofThisMonth(formatUsd(overview.budget.learningBudgetUsd))}
          </span>
        )}
      </div>
      {autonomy?.length ? <AutonomyChips autonomy={autonomy} /> : null}

      <div className="flex flex-wrap items-start gap-6 px-8 py-6">
        <aside
          aria-label={s.ideas}
          className="flex max-w-[340px] flex-[1_1_300px] flex-col gap-[18px]"
          data-testid="idea-groups"
        >
          {IDEA_GROUPS.filter(g => g !== "needs" || access.pmAgent || access.approvePinnedRule).map(
            g => (
              <section key={g} className="flex flex-col gap-1.5" data-testid={`idea-group-${g}`}>
                <h2
                  className={`flex items-center gap-2 text-[13px] font-semibold ${g === "dropped" ? "text-neutral-600" : "text-typography-900"}`}
                >
                  <span className={`h-2 w-2 rounded-full ${GROUP_DOT[g]}`} />
                  {p.groups[g]}{" "}
                  <span className="font-normal text-neutral-600">{grouped[g].length}</span>
                </h2>
                {grouped[g].map(idea => {
                  const sel = focus?.id === idea.id;
                  const left = daysLeft(idea);
                  const warn = g === "needs" && left !== null && left <= EXPIRY_WARNING_DAYS;
                  return (
                    <button
                      key={idea.id}
                      type="button"
                      onClick={() => onFocus(idea.id)}
                      data-testid="idea-list-item"
                      aria-current={sel ? "true" : undefined}
                      className={`flex flex-col gap-[3px] rounded-sm border-l-[3px] px-3 py-2.5 text-left ${sel ? "border-primary-500 bg-neutral-50" : "border-transparent"}`}
                    >
                      <div className="text-sm">
                        <span className="text-xs text-neutral-600">{ideaCode(idea)}</span>{" "}
                        {inWords(idea.title)}
                      </div>
                      <div className="flex gap-2 text-xs text-neutral-600">
                        <span>{ideaMeta(idea)}</span>
                        {g === "needs" && (
                          <span className={`ml-auto ${warn ? "text-[#8A3800]" : ""}`}>
                            {left !== null ? p.daysLeft(left) : waitedFor(idea.createdAt)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </section>
            ),
          )}
        </aside>

        <main className="flex min-w-0 max-w-[800px] flex-[999_1_560px] flex-col gap-4">
          {reverted.length > 0 && (
            <AlertBanner
              kind="error"
              testId="pm-reverted-banner"
              action={
                <button
                  type="button"
                  className="text-sm font-semibold text-primary-500 underline"
                  onClick={() => onFocus(reverted[0].id)}
                >
                  {p.readIt}
                </button>
              }
            >
              <b>{p.revertedBanner(ideaCode(reverted[0]))}</b>
            </AlertBanner>
          )}
          {expiring && (
            <AlertBanner
              kind="warning"
              testId="pm-expiry-banner"
              action={
                <button
                  type="button"
                  className="text-sm font-semibold text-primary-500 underline"
                  onClick={() => onFocus(expiring.id)}
                >
                  {p.answerIt}
                </button>
              }
            >
              <b>{p.expiresBanner(ideaCode(expiring), daysLeft(expiring) ?? 0)}</b>{" "}
              {p.expiresBody(inWords(expiring.title))}
            </AlertBanner>
          )}
          <details
            className="rounded-sm bg-neutral-50 px-[18px] py-3.5 text-sm"
            data-testid="pm-agent-report"
          >
            <summary className="cursor-pointer font-semibold">
              {state.at ? p.report(formatWhen(state.at)) : s.report}
            </summary>
            <p className="mt-2.5 whitespace-pre-wrap leading-relaxed text-neutral-700">
              {state.report ?? s.noReport}
            </p>
          </details>

          {!focus ? (
            <EmptyPanel title={s.noIdeas} message={s.noIdeasMessage} />
          ) : (
            <>
              <IdeaCard
                key={focus.id}
                idea={focus}
                access={access}
                settingSpec={settings.data?.spec}
                canaryShare={canaryShare}
                onDecide={decision => setPending({ id: focus.id, decision })}
              />
              {needIndex >= 0 && (
                <div className="flex justify-between text-sm text-neutral-600">
                  <span>{p.ofNeedYou(needIndex + 1, needs.length)}</span>
                  <span className="flex gap-4">
                    {needIndex > 0 && (
                      <button
                        type="button"
                        className="text-primary-500 underline"
                        onClick={() => onFocus(needs[needIndex - 1].id)}
                      >
                        {p.previous}
                      </button>
                    )}
                    {needIndex < needs.length - 1 && (
                      <button
                        type="button"
                        className="text-primary-500 underline"
                        onClick={() => onFocus(needs[needIndex + 1].id)}
                      >
                        {p.next}
                      </button>
                    )}
                  </span>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <ConfirmDialog
        isOpen={pending !== null}
        title={pending?.decision === "approve" ? approveText("title") : s.rejectTitle}
        cancelLabel={s.cancel}
        confirmLabel={
          pending?.decision === "approve"
            ? pinned
              ? p.pinned.confirm
              : pendingStage === "handoff" && handoffKind
                ? s.handoff.approve[handoffKind]
                : pendingStage === "promote"
                  ? s.promoteConfirm
                  : s.canaryConfirm
            : s.rejectConfirm
        }
        isWorking={deciding}
        onConfirm={() => void confirm()}
        onClose={() => setPending(null)}
      >
        <p>{pending?.decision === "approve" ? approveText("body") : s.rejectBody}</p>
      </ConfirmDialog>
    </>
  );
};

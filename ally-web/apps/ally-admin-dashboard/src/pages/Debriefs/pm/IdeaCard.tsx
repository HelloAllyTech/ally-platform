import React from "react";

import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import { useScreenIdeaMutation } from "@api";
import { formatUsd, shortId } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";
import { DebriefOwnerSettingSpec, PmAgentIdeaRow } from "@types";
import { getErrorMessage } from "@utils";

import {
  canaryReasonLabel,
  codeWords,
  forecastMetricLabel,
  inWords,
  promptName,
  settingChangeLabel,
} from "../consoleLabels";
import { ConsoleTag } from "../consoleUi";
import { DebriefAccess } from "../debriefAccess";
import { waitedFor } from "../queue";
import { Handoff } from "./Handoff";
import {
  daysLeft,
  EXPIRY_WARNING_DAYS,
  HANDOFF_KINDS,
  needsViewer,
  SCREENABLE,
  stage,
} from "./ideaGroups";

export const ideaCode = (idea: PmAgentIdeaRow) => idea.code ?? shortId(idea.id);

const signed = (x: number | null | undefined) =>
  x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(2)}`;
const fixed1 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(1));
const num = (x: number | null | undefined) =>
  x == null ? "—" : String(Math.round(x * 1000) / 1000);

type RungState = "waiting" | "running" | "passed" | "not" | "failed";

/** One rung of the test ladder (v9 FR-52) as a tile: its name, state and the numbers behind it. */
const Rung: React.FC<{
  name: string;
  state: RungState;
  label: string;
  detail: string;
  testId: string;
}> = ({ name, state, label, detail, testId }) => (
  <li
    data-testid={testId}
    className={`flex flex-col gap-0.5 rounded-sm px-3 py-2.5 ${state === "passed" ? "bg-success-50" : "bg-white"}`}
  >
    <span className="text-[13px] font-semibold">{name}</span>
    <span
      className={`text-xs font-semibold ${state === "passed" ? "text-success-600" : state === "failed" || state === "not" ? "text-[#8A3800]" : "text-neutral-600"}`}
    >
      {label}
    </span>
    <span className="text-xs text-neutral-600">{detail}</span>
  </li>
);

export const Ladder: React.FC<{ idea: PmAgentIdeaRow }> = ({ idea }) => {
  const s = en.debriefs.pmAgent;
  const { screen: q, gate: g, trial: t, canary: c } = idea.evidence;
  const words: Record<RungState, string> = {
    waiting: s.rungWaiting,
    running: s.rungRunning,
    passed: s.rungPassed,
    not: s.rungNotPassed,
    failed: s.rungFailed,
  };
  const qs: RungState = !q
    ? "waiting"
    : q.status === "running"
      ? "running"
      : q.status === "failed"
        ? "failed"
        : q.passed
          ? "passed"
          : "not";
  const gs: RungState = !g
    ? "waiting"
    : g.status !== "done"
      ? g.status === "running"
        ? "running"
        : "failed"
      : g.passed
        ? "passed"
        : "not";
  const ts: RungState = !t
    ? "waiting"
    : t.status === "running"
      ? "running"
      : t.status === "passed"
        ? "passed"
        : "not";
  const cs: RungState = !c
    ? "waiting"
    : c.status === "running"
      ? "running"
      : c.status === "reverted"
        ? "not"
        : "passed";
  return (
    <div>
      <div className="mb-2 text-xs text-neutral-600">{en.debriefs.pmPage.tests}</div>
      <ol className="grid list-none grid-cols-2 gap-2 sm:grid-cols-4" data-testid="idea-ladder">
        <Rung
          testId="idea-screen"
          name={s.ladder.quick}
          state={qs}
          label={q ? words[qs] : s.notScreened}
          detail={
            q?.status === "done"
              ? `${s.screened(signed(q.lift), q.pairs)} · ${formatUsd(q.costUsd)}${q.challengerFailures > 0 ? ` · ${s.unfinished(q.challengerFailures)}` : ""}`
              : ""
          }
        />
        <Rung
          testId="idea-gate"
          name={s.ladder.gate}
          state={gs}
          label={words[gs]}
          detail={
            g?.status === "done"
              ? `${s.gateLine(fixed1(g.baselineMedian), fixed1(g.challengerMedian), g.pairs)}${
                  !g.passed
                    ? ` · ${Object.entries(g.rules)
                        .filter(([, ok]) => !ok)
                        .map(([k]) => s.gateRules[k] ?? codeWords(k))
                        .join(", ")}`
                    : ""
                }`
              : ""
          }
        />
        <Rung
          testId="idea-trial"
          name={s.ladder.trial}
          state={ts}
          label={words[ts]}
          detail={
            t
              ? s.trialLine(
                  t.comparisons,
                  signed(t.meanDifference),
                  signed(t.lower),
                  signed(t.upper),
                )
              : ""
          }
        />
        <Rung
          testId="idea-canary"
          name={s.ladder.canary}
          state={cs}
          label={
            c
              ? (s.canaryStatus[c.status] ?? c.status)
              : stage(idea) === "canary"
                ? en.debriefs.pmPage.needsApproval
                : s.rungWaiting
          }
          detail={
            c
              ? `${s.canaryLine(Math.round(c.share * 100), c.canaryRuns ?? 0, fixed1(c.canaryMedian), fixed1(c.controlMedian))}${
                  c.reason && c.status === "reverted" ? ` · ${canaryReasonLabel(c.reason)}` : ""
                }`
              : ""
          }
        />
      </ol>
    </div>
  );
};

/** The idea in focus on the PM agent page: the change, its tests and evidence, and the decision. */
export const IdeaCard: React.FC<{
  idea: PmAgentIdeaRow;
  access: DebriefAccess;
  settingSpec?: Record<string, DebriefOwnerSettingSpec>;
  canaryShare?: number;
  onDecide: (d: "approve" | "reject") => void;
}> = ({ idea, access, settingSpec, canaryShare, onDecide }) => {
  const s = en.debriefs.pmAgent;
  const p = en.debriefs.pmPage;
  const [screen, { isLoading: screening }] = useScreenIdeaMutation();
  const next = stage(idea);
  const mine = needsViewer(idea, access);
  const left = daysLeft(idea);
  const open = idea.status === "proposed";
  const live = idea.status === "active" && idea.releaseStatus === "ga";
  const statusLabel = idea.expired
    ? p.expired
    : idea.status === "active" && !live
      ? s.noLongerLive
      : (s.ideaStatus[idea.status] ?? idea.status);
  const pinned = idea.change.ideaKind === "pinned_rule";
  const canPromote = access.pmAgent && next === "promote";
  return (
    <article
      className="flex flex-col gap-[18px] rounded-sm bg-neutral-50 px-7 py-6"
      data-testid="idea"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-neutral-600">{ideaCode(idea)}</span>
        <ConsoleTag tone="info">
          {p.kinds[idea.change.ideaKind] ??
            s.kinds[idea.change.ideaKind] ??
            codeWords(idea.change.ideaKind)}
          {idea.change.promptCode ? ` · ${promptName(idea.change.promptCode)}` : ""}
        </ConsoleTag>
        <ConsoleTag tone={live ? "success" : open && !idea.expired ? "warning" : "neutral"}>
          {statusLabel}
        </ConsoleTag>
        <span className="ml-auto text-[13px] text-neutral-600">
          {p.waiting(waitedFor(idea.createdAt))}
          {left !== null && open && !idea.expired ? ` · ${p.expiresIn(left)}` : ""}
        </span>
      </div>
      <h2 className="text-2xl font-semibold leading-snug">{inWords(idea.title)}</h2>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 text-sm leading-normal">
        {(idea.evidence.hypothesis || idea.evidence.evidence) && (
          <div>
            <div className="mb-0.5 text-xs text-neutral-600">{s.why}</div>
            {inWords(idea.evidence.hypothesis)} {inWords(idea.evidence.evidence)}
          </div>
        )}
        {idea.evidence.expectedEffect && (
          <div>
            <div className="mb-0.5 text-xs text-neutral-600">{s.expected}</div>
            {inWords(idea.evidence.expectedEffect)}
          </div>
        )}
      </div>

      {idea.change.find && (
        <div
          className="overflow-hidden rounded-sm bg-white text-[13px] leading-relaxed"
          data-testid="idea-diff"
        >
          <div className="whitespace-pre-wrap bg-destructive-50 px-3.5 py-2.5 text-destructive-600 line-through">
            {idea.change.find}
          </div>
          <div className="whitespace-pre-wrap bg-success-50 px-3.5 py-2.5 text-success-600">
            {idea.change.replace}
          </div>
        </div>
      )}
      {idea.change.ideaKind === "setting" && (
        <p className="text-sm" data-testid="idea-setting">
          <span className="font-semibold">{s.change}:</span>{" "}
          {settingChangeLabel(
            idea.change.settingKey,
            idea.change.settingValue,
            idea.change.settingKey ? settingSpec?.[idea.change.settingKey] : undefined,
          )}
        </p>
      )}
      {idea.evidence.forecast?.checkedAt && (
        <p className="text-sm" data-testid="idea-forecast">
          {s.forecast(
            forecastMetricLabel(idea.evidence.forecast.metric),
            num(idea.evidence.forecast.baseline),
            num(idea.evidence.forecast.after),
            idea.evidence.forecast.moved == null
              ? s.forecastMoved.unknown
              : idea.evidence.forecast.moved
                ? s.forecastMoved.yes
                : s.forecastMoved.no,
          )}
        </p>
      )}
      <Handoff idea={idea} />
      {SCREENABLE.has(idea.change.ideaKind) && <Ladder idea={idea} />}

      {open && !idea.expired && (mine || canPromote || access.pmAgent) && (
        <div className="flex flex-col gap-2.5" data-testid="idea-actions">
          {mine && next === "canary" && (
            <button
              type="button"
              onClick={() => onDecide("approve")}
              className="flex h-12 items-center justify-between rounded-sm bg-primary-500 px-4 text-[15px] font-semibold text-white"
            >
              {p.approveCanary}
              {canaryShare != null && (
                <span className="text-xs font-normal opacity-90">
                  {p.recommended(Math.round(canaryShare * 100))}
                </span>
              )}
            </button>
          )}
          {canPromote && (
            <Button kind="primary" size="lg" onClick={() => onDecide("approve")}>
              {s.promote}
            </Button>
          )}
          {mine && next === "handoff" && idea.evidence.handoff && (
            <Button kind="primary" size="lg" onClick={() => onDecide("approve")}>
              {s.handoff.approve[idea.evidence.handoff.kind]}
            </Button>
          )}
          {mine && pinned && (
            <Button kind="primary" size="lg" onClick={() => onDecide("approve")}>
              {p.approvePinned}
            </Button>
          )}
          <div className="flex flex-wrap gap-2.5">
            {access.pmAgent && SCREENABLE.has(idea.change.ideaKind) && (
              <Button
                kind="tertiary"
                size="md"
                disabled={screening || idea.evidence.screen?.status === "running"}
                onClick={() =>
                  void screen(idea.id)
                    .unwrap()
                    .catch(e => toast.error(getErrorMessage(e, s.actionFailed)))
                }
              >
                {screening || idea.evidence.screen?.status === "running" ? s.screening : s.screen}
              </Button>
            )}
            {(pinned ? access.approvePinnedRule : access.pmAgent) && (
              <Button kind="danger--tertiary" size="md" onClick={() => onDecide("reject")}>
                {s.reject}
              </Button>
            )}
          </div>
          {access.pmAgent && !mine && !canPromote && SCREENABLE.has(idea.change.ideaKind) && (
            <p className="text-xs text-neutral-600">{s.canaryNeedsTrial}</p>
          )}
        </div>
      )}
      {open && left !== null && left <= EXPIRY_WARNING_DAYS && !idea.expired && (
        <p className="text-xs text-[#8A3800]">{p.expiresIn(left)}</p>
      )}

      {((idea.evidence.commentIds?.length ?? 0) > 0 ||
        idea.evidence.handoff?.kind === "bug_hunter") && (
        <div className="border-t border-neutral-100 pt-3.5 text-[13px] leading-relaxed text-neutral-600">
          {p.basedOn(s.evidenceComments(idea.evidence.commentIds?.length ?? 0))}
        </div>
      )}
    </article>
  );
};

export { HANDOFF_KINDS };

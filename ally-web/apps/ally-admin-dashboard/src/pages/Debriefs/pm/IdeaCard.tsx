import React, { useState } from "react";

import { toast } from "sonner";

import { Button, TextArea } from "@ally-ui-mono/ui-shared";
import { useAskIdeaQuestionMutation, useScreenIdeaMutation, useStartIdeaStepMutation } from "@api";
import { shortId } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";
import { DebriefOwnerSettingSpec, PmAgentIdeaRow } from "@types";
import { getErrorMessage } from "@utils";

import {
  codeWords,
  forecastMetricLabel,
  inWords,
  promptName,
  settingChangeLabel,
} from "../consoleLabels";
import { formatWhen } from "../consoleTable";
import { ConsoleTag } from "../consoleUi";
import { DebriefAccess } from "../debriefAccess";
import { waitedFor } from "../queue";
import { EvidenceBlock } from "./EvidenceBlock";
import { Handoff } from "./Handoff";
import {
  daysLeft,
  EXPIRY_WARNING_DAYS,
  ideaGroup,
  needsViewer,
  SCREENABLE,
  stage,
} from "./ideaGroups";

export const ideaCode = (idea: PmAgentIdeaRow) => idea.code ?? shortId(idea.id);

const num = (x: number | null | undefined) =>
  x == null ? "—" : String(Math.round(x * 1000) / 1000);

/** What the change touches, in one line (the draft release's summary). */
export const changeSummary = (
  idea: PmAgentIdeaRow,
  spec?: Record<string, DebriefOwnerSettingSpec>,
): string => {
  const p = en.debriefs.pmPage;
  if (idea.change.promptCode) return p.draft.prompt(promptName(idea.change.promptCode));
  if (idea.change.settingKey) {
    return settingChangeLabel(
      idea.change.settingKey,
      idea.change.settingValue,
      spec?.[idea.change.settingKey],
    );
  }
  return p.kinds[idea.change.ideaKind] ?? codeWords(idea.change.ideaKind);
};

/** Ask a question about an idea: the PM agent reads it on its next run. */
const Questions: React.FC<{ idea: PmAgentIdeaRow; canAsk: boolean; startOpen: boolean }> = ({
  idea,
  canAsk,
  startOpen,
}) => {
  const p = en.debriefs.pmPage.questions;
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState("");
  const [ask, { isLoading }] = useAskIdeaQuestionMutation();
  const thread = idea.questions ?? [];
  const post = async () => {
    try {
      await ask({ id: idea.id, text: text.trim() }).unwrap();
      toast.success(p.sent);
      setText("");
      setOpen(false);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.pmAgent.actionFailed));
    }
  };
  if (!thread.length && !open) return null;
  return (
    <div className="flex flex-col gap-2 rounded-sm bg-white px-4 py-3" data-testid="idea-questions">
      {thread.map(q => (
        <div key={q.id} className="text-sm">
          <div className="text-xs text-neutral-600">
            {q.role === "agent" ? p.agent : (q.by ?? p.someone)} · {formatWhen(q.at)}
          </div>
          <div>{q.text}</div>
        </div>
      ))}
      {thread.length > 0 && <p className="text-xs text-neutral-600">{p.noAnswerYet}</p>}
      {open && canAsk && (
        <>
          <TextArea
            id={`idea-question-${idea.id}`}
            labelText={p.label}
            helperText={p.help}
            rows={2}
            value={text}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              kind="primary"
              size="sm"
              disabled={!text.trim() || isLoading}
              onClick={() => void post()}
            >
              {p.send}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setOpen(false)}>
              {en.debriefs.pmAgent.cancel}
            </Button>
          </div>
        </>
      )}
      {!open && canAsk && (
        <button
          type="button"
          className="self-start text-sm text-primary-500 underline"
          onClick={() => setOpen(true)}
        >
          {p.askAnother}
        </button>
      )}
    </div>
  );
};

/** The idea in focus on the PM agent page: the change, its tests and evidence, and the decision. */
export const IdeaCard: React.FC<{
  idea: PmAgentIdeaRow;
  access: DebriefAccess;
  settingSpec?: Record<string, DebriefOwnerSettingSpec>;
  canaryShare?: number;
  liveVersion?: number | null;
  onDecide: (d: "approve" | "reject") => void;
  onOpenRelease?: (version: number) => void;
}> = ({ idea, access, settingSpec, canaryShare, liveVersion, onDecide, onOpenRelease }) => {
  const s = en.debriefs.pmAgent;
  const p = en.debriefs.pmPage;
  const [screen, { isLoading: screening }] = useScreenIdeaMutation();
  const [startStep, { isLoading: starting }] = useStartIdeaStepMutation();
  const [asking, setAsking] = useState(false);
  const next = stage(idea);
  const mine = needsViewer(idea, access);
  const left = daysLeft(idea);
  const group = ideaGroup(idea, access);
  const open = idea.status === "proposed" && !["expired", "reverted", "rejected"].includes(group);
  const pinned = idea.change.ideaKind === "pinned_rule";
  const can = idea.can ?? {
    approve: mine,
    reject: pinned ? access.approvePinnedRule : access.pmAgent,
    tryIt: access.pmAgent && SCREENABLE.has(idea.change.ideaKind),
    askQuestion: false,
    startStep: false,
  };
  const wait = idea.approval?.wait;
  const canPromote = access.pmAgent && (wait === "promote" || next === "promote");
  const statusLabel =
    group === "expired"
      ? p.expired
      : group === "promoted"
        ? idea.releaseStatus === "ga"
          ? s.ideaStatus.active
          : s.noLongerLive
        : (p.groupStatus[group] ?? s.ideaStatus[idea.status] ?? idea.status);
  const draft =
    idea.releaseVersion != null && idea.releaseStatus !== "ga" && open ? idea.releaseVersion : null;

  const start = async (step: "gate_test" | "paired_trial") => {
    try {
      await startStep({ id: idea.id, step }).unwrap();
      toast.success(p.stepStarted);
    } catch (e) {
      toast.error(getErrorMessage(e, s.actionFailed));
    }
  };

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
        <ConsoleTag tone={group === "promoted" ? "success" : open ? "warning" : "neutral"}>
          {statusLabel}
        </ConsoleTag>
        <span className="ml-auto text-[13px] text-neutral-600">
          {open && p.waiting(waitedFor(idea.approval?.since ?? idea.createdAt))}
          {left !== null && open ? ` · ${p.expiresIn(left)}` : ""}
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
      {draft !== null && (
        <div
          className="flex flex-col gap-1 rounded-sm border border-primary-200 bg-white px-4 py-3"
          data-testid="idea-draft-release"
        >
          <div className="flex flex-wrap items-baseline gap-2 text-sm">
            <span className="font-semibold">{p.draft.title(draft)}</span>
            <span className="text-neutral-600">{p.draft.help}</span>
            {liveVersion != null && (
              <span className="ml-auto text-[13px] text-neutral-600">
                {p.draft.against(liveVersion)}
              </span>
            )}
          </div>
          <div className="text-[13px] text-neutral-700">
            {changeSummary(idea, settingSpec)}
            {liveVersion != null ? ` · ${p.draft.rest(liveVersion)}` : ""}
          </div>
        </div>
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
      {SCREENABLE.has(idea.change.ideaKind) && (
        <EvidenceBlock title={p.tests} idea={idea} testId="idea-evidence" />
      )}
      {group === "promoted" && idea.releaseVersion != null && onOpenRelease && (
        <button
          type="button"
          className="self-start text-sm text-primary-500 underline"
          onClick={() => onOpenRelease(idea.releaseVersion as number)}
        >
          {p.becameRelease(idea.releaseVersion)}
        </button>
      )}

      {open &&
        (can.approve ||
          canPromote ||
          can.reject ||
          can.tryIt ||
          can.askQuestion ||
          can.startStep) && (
          <div className="flex flex-col gap-2.5" data-testid="idea-actions">
            {can.approve && next === "canary" && !pinned && (
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
            {can.approve && next === "handoff" && idea.evidence.handoff && (
              <Button kind="primary" size="lg" onClick={() => onDecide("approve")}>
                {s.handoff.approve[idea.evidence.handoff.kind]}
              </Button>
            )}
            {pinned && (idea.can ? idea.can.approve : access.approvePinnedRule) && (
              <Button kind="primary" size="lg" onClick={() => onDecide("approve")}>
                {p.approvePinned}
              </Button>
            )}
            {can.startStep && (wait === "start_gate" || wait === "start_trial") && (
              <Button
                kind="primary"
                size="lg"
                disabled={starting}
                onClick={() => void start(wait === "start_gate" ? "gate_test" : "paired_trial")}
              >
                {wait === "start_gate" ? p.startGate : p.startTrial}
              </Button>
            )}
            <div className="flex flex-wrap gap-2.5">
              {can.askQuestion && (
                <Button kind="tertiary" size="md" onClick={() => setAsking(true)}>
                  {p.questions.ask}
                </Button>
              )}
              {can.tryIt && SCREENABLE.has(idea.change.ideaKind) && (
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
              {can.reject && (
                <Button kind="danger--tertiary" size="md" onClick={() => onDecide("reject")}>
                  {s.reject}
                </Button>
              )}
            </div>
          </div>
        )}
      {(asking || (idea.questions?.length ?? 0) > 0) && (
        <Questions key={String(asking)} idea={idea} canAsk={can.askQuestion} startOpen={asking} />
      )}
      {open && left !== null && left <= EXPIRY_WARNING_DAYS && (
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

import React, { useEffect, useMemo, useState } from "react";

import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, TextArea } from "@ally-ui-mono/ui-shared";
import {
  useAnswerIdeaBuilderQuestionMutation,
  useDecideIdeaMutation,
  useGetIdeaBuilderProgressQuery,
} from "@api";
import { DecisionOptions } from "@components/builder/DecisionOptions";
import { en, ROUTES } from "@constants";
import {
  PmAgentBuilderAnswerer,
  PmAgentBuilderProgress,
  PmAgentBuilderStage,
  PmAgentIdeaRow,
} from "@types";
import { getErrorMessage } from "@utils";

import { orderOptions } from "../../Builder/decisionFeed";
import { inWords } from "../consoleLabels";

const strings = () => en.debriefs.pmAgent.handoff.toBuilder;

/** While Builder can still move on its own, the card re-reads it this often. */
const POLL_MS = 15_000;

/** "Why", "What Builder should build", "How we'll know it worked": the PM agent's brief. */
export const BuilderBrief: React.FC<{ idea: PmAgentIdeaRow }> = ({ idea }) => {
  const s = strings();
  const h = idea.evidence.handoff;
  if (h?.kind !== "builder") return null;
  return (
    <div
      className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 text-sm leading-normal"
      data-testid="builder-brief"
    >
      <div>
        <div className="mb-0.5 text-xs text-neutral-600">{s.why}</div>
        <p className="whitespace-pre-wrap">
          {inWords(h.problem)} {inWords(h.evidenceSummary)}
        </p>
      </div>
      <div>
        <div className="mb-0.5 text-xs text-neutral-600">{s.what}</div>
        {h.acceptanceChecks.length === 1 ? (
          <p>{h.acceptanceChecks[0]}</p>
        ) : (
          <ul className="list-disc pl-5">
            {h.acceptanceChecks.map(c => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-0.5 text-xs text-neutral-600">{s.how}</div>
        <p className="whitespace-pre-wrap">{inWords(h.expectedEffect)}</p>
      </div>
    </div>
  );
};

/** Before the hand-off: who answers Builder's questions, and the person's click. */
export const HandToBuilder: React.FC<{ idea: PmAgentIdeaRow }> = ({ idea }) => {
  const s = strings();
  const navigate = useNavigate();
  const [answerer, setAnswerer] = useState<PmAgentBuilderAnswerer>("pm_agent");
  const [decide, { isLoading }] = useDecideIdeaMutation();
  const handOver = async () => {
    try {
      const out = await decide({ id: idea.id, decision: "approve", answerer }).unwrap();
      toast.success(answerer === "pm_agent" ? s.handedPmAgent : s.handedMe);
      if (answerer === "person" && out?.id) navigate(ROUTES.BUILDER_SESSION(out.id));
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.pmAgent.actionFailed));
    }
  };
  const option = (
    value: PmAgentBuilderAnswerer,
    label: React.ReactNode,
    help: string,
  ): React.ReactNode => (
    <label className="flex items-start gap-2.5 text-sm leading-normal">
      <input
        type="radio"
        name={`builder-answerer-${idea.id}`}
        value={value}
        checked={answerer === value}
        onChange={() => setAnswerer(value)}
        className="mt-1 accent-primary-500"
      />
      <span>
        {label}
        <br />
        <span className="text-neutral-600">{help}</span>
      </span>
    </label>
  );
  return (
    <fieldset
      className="flex flex-col gap-2.5 rounded-sm bg-white px-4 py-3.5"
      data-testid="hand-to-builder"
    >
      <legend className="mb-1.5 p-0 text-[15px] font-semibold">{s.who}</legend>
      {option(
        "pm_agent",
        <>
          <b>{s.pmAgent}</b> {s.recommended}
        </>,
        s.pmAgentHelp,
      )}
      {option("person", <b>{s.me}</b>, s.meHelp)}
      <p className="text-xs text-neutral-600">{s.note}</p>
      <Button
        kind="primary"
        size="lg"
        className="self-start"
        disabled={isLoading}
        onClick={() => void handOver()}
      >
        {s.button}
      </Button>
    </fieldset>
  );
};

type StepTone = "done" | "now" | "wait";

interface Step {
  name: string;
  state: string;
  tone: StepTone;
}

const ORDER: PmAgentBuilderStage[] = ["interviewing", "building", "pr_open", "merged"];

/** The four steps the card shows, from where Builder really is. */
export const builderSteps = (p: PmAgentBuilderProgress): Step[] => {
  const s = strings();
  const at = p.stage === "closed" ? -1 : ORDER.indexOf(p.stage);
  const past = (stage: PmAgentBuilderStage) => at > ORDER.indexOf(stage);
  const n = p.answers.length;
  const pm = p.answerer === "pm_agent";
  const interview: Step =
    p.stage === "interviewing"
      ? {
          name: s.steps.interview,
          state: pm ? s.step.pmAnswered(n) : s.step.inProgress,
          tone: "now",
        }
      : {
          name: s.steps.interview,
          state: pm ? s.step.doneAnswers(n) : s.step.done,
          tone: p.stage === "closed" ? "wait" : "done",
        };
  const input: Step =
    p.waiting?.kind === "question"
      ? { name: s.steps.input, state: s.step.questionWaiting, tone: "now" }
      : p.waiting?.kind === "brief"
        ? { name: s.steps.input, state: s.step.confirmWaiting, tone: "now" }
        : {
            name: s.steps.input,
            state: p.stage === "interviewing" ? s.step.nothingWaiting : s.step.done,
            tone: p.stage === "interviewing" || p.stage === "closed" ? "wait" : "done",
          };
  const building: Step =
    p.stage === "building"
      ? { name: s.steps.building, state: s.step.inProgress, tone: "now" }
      : past("building")
        ? { name: s.steps.building, state: s.step.done, tone: "done" }
        : { name: s.steps.building, state: s.step.notStarted, tone: "wait" };
  const pr: Step =
    p.stage === "pr_open"
      ? { name: s.steps.pr, state: s.step.waitingReview, tone: "now" }
      : p.stage === "merged"
        ? { name: s.steps.pr, state: s.step.merged, tone: "done" }
        : p.stage === "closed" && p.pullRequests.length
          ? { name: s.steps.pr, state: s.step.closed, tone: "wait" }
          : { name: s.steps.pr, state: s.step.none, tone: "wait" };
  return [interview, input, building, pr];
};

const TONE: Record<StepTone, string> = {
  done: "bg-success-50 text-success-600",
  now: "bg-warning-50 text-warning-700",
  wait: "bg-white text-neutral-600",
};

/**
 * The question Builder waits on a person for: Builder's own options, drawn as its feed draws them,
 * a "Something else" box for the person's own words, and the PM agent's answers. "Send to Builder"
 * sends the answer in the feed's shape: the picked option ids, the words, or (several at once)
 * both.
 */
const WaitingQuestion: React.FC<{
  idea: PmAgentIdeaRow;
  progress: PmAgentBuilderProgress;
  canAnswer: boolean;
}> = ({ idea, progress, canAnswer }) => {
  const s = strings();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [showAnswers, setShowAnswers] = useState(false);
  const [send, { isLoading }] = useAnswerIdeaBuilderQuestionMutation();
  const w = progress.waiting?.kind === "question" ? progress.waiting : null;
  const questionId = w?.questionId ?? null;
  const options = useMemo(() => orderOptions(w?.options ?? []), [w?.options]);
  // A new question starts clean; polling hands back a fresh object for the same one.
  useEffect(() => {
    setPicked([]);
    setText("");
  }, [questionId]);
  if (!w) return null;
  const n = progress.answers.length;
  const isMulti = w.selection === "multi";
  const words = text.trim();
  const minSelections = w.minSelections ?? 1;
  const ready = isMulti
    ? picked.length + (words ? 1 : 0) >= minSelections
    : picked.length > 0 || !!words;

  // One option, or several. Picking one of a single-choice question clears any words typed
  // (and typing clears the pick): one answer goes, as the feed sends it.
  const choose = (id: string) => {
    if (isMulti) {
      setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
      return;
    }
    setPicked(p => (p[0] === id ? [] : [id]));
    setText("");
  };
  const type = (value: string) => {
    setText(value);
    if (!isMulti && value.trim()) setPicked([]);
  };

  const post = async () => {
    const answer =
      isMulti || !picked.length
        ? {
            ...(picked.length ? { selectedOptionIds: picked } : {}),
            ...(words ? { customValues: [words], message: words } : {}),
          }
        : { selectedOptionIds: picked };
    try {
      await send({ id: idea.id, questionId: w.questionId, ...answer }).unwrap();
      toast.success(s.sent);
      setText("");
      setPicked([]);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.pmAgent.actionFailed));
    }
  };
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 border-l-[3px] border-warning-400 bg-white px-3.5 py-3"
      data-testid="builder-question"
    >
      <p className="text-sm">
        <b>{s.question}</b>
        {progress.answerer === "pm_agent" ? ` ${s.pmAgentCount(n)}` : ""}
      </p>
      <p className="bg-neutral-50 px-2.5 py-2 text-sm">“{w.prompt}”</p>
      {w.reason && <p className="text-xs text-neutral-600">{s.whyYou(w.reason)}</p>}
      {canAnswer && (
        <DecisionOptions
          options={options}
          picked={picked}
          isMulti={isMulti}
          disabled={isLoading}
          onChoose={o => choose(o.id)}
          keyboard={false}
        />
      )}
      {canAnswer && options.length > 0 && isMulti && (
        <p className="text-xs text-neutral-600">{s.pickSeveral}</p>
      )}
      {canAnswer && (
        <TextArea
          id={`builder-answer-${idea.id}`}
          labelText={options.length ? s.somethingElse : s.answerLabel}
          rows={2}
          value={text}
          placeholder={options.length ? (w.customPlaceholder ?? undefined) : undefined}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => type(e.target.value)}
        />
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {canAnswer && (
          <Button
            kind="primary"
            size="sm"
            disabled={!ready || isLoading}
            onClick={() => void post()}
          >
            {s.send}
          </Button>
        )}
        {n > 0 && (
          <button
            type="button"
            className="text-primary-500 underline"
            onClick={() => setShowAnswers(v => !v)}
          >
            {showAnswers ? s.hideAnswers : s.seeAnswers(n)}
          </button>
        )}
        <OpenSession sessionId={progress.sessionId} />
      </div>
      {showAnswers && <Answers progress={progress} />}
    </div>
  );
};

const Answers: React.FC<{ progress: PmAgentBuilderProgress }> = ({ progress }) => (
  <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm" data-testid="builder-pm-answers">
    {progress.answers.map(a => (
      <li key={a.questionId}>
        <div className="text-neutral-600">{a.question}</div>
        <div>{a.answer}</div>
      </li>
    ))}
  </ol>
);

const OpenSession: React.FC<{ sessionId: string }> = ({ sessionId }) => (
  <Link
    to={ROUTES.BUILDER_SESSION(sessionId)}
    className="text-sm text-primary-500 underline"
    data-testid="open-builder-session"
  >
    {strings().openSession}
  </Link>
);

/**
 * After the hand-off: where the idea stands in Builder, from the session's real status.
 * Read only by people who may act on PM agent ideas (the endpoint's own rule); anyone else
 * gets the link to the session.
 */
export const BuilderProgress: React.FC<{ idea: PmAgentIdeaRow; canAnswer: boolean }> = ({
  idea,
  canAnswer,
}) => {
  const s = strings();
  const [showAnswers, setShowAnswers] = useState(false);
  const [poll, setPoll] = useState(POLL_MS);
  const sessionId = idea.evidence.handoff?.filedId ?? null;
  const live = useGetIdeaBuilderProgressQuery(idea.id, {
    pollingInterval: poll,
    skip: !canAnswer || !sessionId,
  });
  const progress = live.data;
  const terminal = progress?.stage === "merged" || progress?.stage === "closed";
  useEffect(() => setPoll(terminal ? 0 : POLL_MS), [terminal]);
  if (!sessionId) return null;
  if (!canAnswer) {
    return (
      <div className="text-sm" data-testid="builder-progress">
        <OpenSession sessionId={sessionId} />
      </div>
    );
  }
  if (!progress) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="builder-progress">
        <span className="text-neutral-600">{live.isError ? s.failed : s.loading}</span>
        <OpenSession sessionId={sessionId} />
      </div>
    );
  }
  const steps = builderSteps(progress);
  const firstPr = progress.pullRequests.find(pr => !pr.merged && (pr.state ?? "open") === "open");
  const n = progress.answers.length;
  return (
    <div className="flex flex-col gap-3" data-testid="builder-progress">
      <p className="text-sm font-semibold" data-testid="builder-stage">
        {s.inBuilder(s.stage[progress.stage] ?? progress.stage)}
      </p>
      <ol className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 sm:grid-cols-4">
        {steps.map(step => (
          <li key={step.name} className={`flex flex-col gap-0.5 px-2.5 py-2 ${TONE[step.tone]}`}>
            <span className="text-[13px] font-semibold text-typography-900">{step.name}</span>
            <span className="text-xs">{step.state}</span>
          </li>
        ))}
      </ol>
      {progress.waiting?.kind === "question" ? (
        <WaitingQuestion idea={idea} progress={progress} canAnswer={canAnswer} />
      ) : (
        <div className="flex flex-col gap-2 bg-white px-3.5 py-3 text-sm">
          <p>
            {progress.waiting?.kind === "brief"
              ? s.brief
              : progress.waiting?.kind === "pm_agent"
                ? s.pmAgentAnswering
                : progress.stage === "pr_open"
                  ? s.prOpen
                  : progress.stage === "merged"
                    ? s.merged
                    : progress.stage === "closed"
                      ? s.closed
                      : null}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {progress.stage === "pr_open" && firstPr && (
              <a
                href={firstPr.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary-500 underline"
                data-testid="open-pull-request"
              >
                {s.openPr}
              </a>
            )}
            {n > 0 && (
              <button
                type="button"
                className="text-primary-500 underline"
                onClick={() => setShowAnswers(v => !v)}
              >
                {showAnswers ? s.hideAnswers : s.seeAnswers(n)}
              </button>
            )}
            <OpenSession sessionId={progress.sessionId} />
          </div>
          {showAnswers && <Answers progress={progress} />}
        </div>
      )}
    </div>
  );
};

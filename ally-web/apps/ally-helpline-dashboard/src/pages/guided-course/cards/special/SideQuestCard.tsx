import { FC, useId, useState } from "react";

import { useTranslation } from "react-i18next";

import { MESSAGE_MAX_CHARS } from "../../stage/ComposerArea";
import { CardFrame } from "../CardFrame";

import type {
  GuideCard,
  GuideMicroActivity,
  GuideMicroActivityRequest,
  GuideMicroActivityResult,
} from "../../contract/wire";
import type { PracticeState } from "../../hooks/useGuideJourney";

/** The kinds a learner writes an answer to; the rest are questions with options. */
const WRITTEN_KINDS: ReadonlyArray<GuideMicroActivity["kind"]> = [
  "rehearse_line",
  "teach_back",
  "reflection",
];

export const activityOf = (card: GuideCard): GuideMicroActivity | null => {
  const activity = (card.payload as { activity?: unknown } | undefined)?.activity;
  if (!activity || typeof activity !== "object") return null;
  const kind = (activity as { kind?: unknown }).kind;
  return typeof kind === "string" ? (activity as GuideMicroActivity) : null;
};

/**
 * A side quest answered before this page loaded: the server sends back the
 * learner's answer and its marks or note on the done card, so it reads as it
 * was left. Undefined for an older card without them (only the receipt shows).
 */
export const savedPracticeOf = (card: GuideCard): PracticeState | undefined => {
  if (card.state !== "done") return undefined;
  const payload = card.payload as
    | { result?: GuideMicroActivityResult; response?: GuideMicroActivityRequest }
    | undefined;
  if (!payload?.result) return undefined;
  return { status: "done", request: payload.response ?? {}, result: payload.result };
};

const isWritten = (activity: GuideMicroActivity): boolean =>
  WRITTEN_KINDS.includes(activity.kind) || !activity.questions?.length;

export interface SideQuestCardProps {
  card: GuideCard;
  activity: GuideMicroActivity;
  practice: PracticeState | undefined;
  onAnswer: (cardId: string, request: GuideMicroActivityRequest) => void;
  onSkip: (cardId: string) => void;
}

/**
 * A side quest (plan §4.6): optional practice in Ally's own card. It says
 * up front that it doesn't count, and Skip is always there and never shamed.
 * Questions are answered on the card and marked against the course's answer,
 * with Ally's line on each; a written answer gets one note from the Coach.
 * Never a score (Stacks: "Action Activities Should Not Be Graded for
 * Correctness"): the marks say what the course would answer, nothing more.
 */
export const SideQuestCard: FC<SideQuestCardProps> = ({
  card,
  activity,
  practice,
  onAnswer,
  onSkip,
}) => {
  const { t } = useTranslation();
  const written = isWritten(activity);
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (practice?.request.answers ?? []).map(answer => [answer.questionId, answer.optionId]),
    ),
  );
  const [text, setText] = useState(practice?.request.text ?? "");

  if (card.state === "dismissed") {
    return <p className="g-caption">{t("guide.practice.skipped")}</p>;
  }
  if (card.state === "failed") {
    return <p className="g-caption">{t("guide.practice.failed")}</p>;
  }

  const result = practice?.status === "done" ? practice.result : undefined;
  const sending = practice?.status === "sending";
  // Done on the server, but answered before this page loaded: only the receipt.
  const doneElsewhere = card.state === "done" && !result;
  const questions = activity.questions ?? [];
  const answered = written
    ? text.trim().length > 0 && text.length <= MESSAGE_MAX_CHARS
    : questions.length > 0 && questions.every(q => choices[q.id]);

  const submit = () => {
    if (!answered || sending) return;
    onAnswer(
      card.cardId,
      written
        ? { text: text.trim() }
        : {
            answers: questions.map(q => ({ questionId: q.id, optionId: choices[q.id] })),
          },
    );
  };

  const meta = [t(`guide.practice.kind.${activity.kind}`), t("guide.practice.noXp")].join(" · ");
  const open = !result && !doneElsewhere;

  return (
    <CardFrame
      testId={`card-${card.cardId}`}
      // Just answered: the full card stays, marked Done, so the marks and notes read
      // in place. Answered before this page loaded: only the receipt.
      state={
        doneElsewhere ? "done" : result ? "active" : card.state === "active" ? "ready" : card.state
      }
      stateLabel={result ? t("guide.card.state.done") : null}
      surface="ally"
      typeWord={t("guide.practice.label")}
      meta={meta}
      title={card.title}
      framing={card.framing ?? activity.intro ?? null}
      receipt={doneElsewhere ? t("guide.practice.doneReceipt") : null}
      primary={
        open
          ? {
              label: sending
                ? t("guide.practice.sending")
                : written
                  ? t("guide.practice.sendWritten")
                  : t("guide.practice.check"),
              onClick: submit,
              disabled: !answered || sending,
            }
          : null
      }
      secondary={
        open && !sending
          ? { label: t("guide.practice.skip"), onClick: () => onSkip(card.cardId) }
          : null
      }
      footer={<p className="g-caption mt-3">{t("guide.practice.footer")}</p>}
    >
      {!doneElsewhere && (
        <div className="mt-3 flex flex-col gap-4" data-testid="side-quest">
          {written ? (
            <WrittenAnswer
              activity={activity}
              text={text}
              onChange={setText}
              locked={Boolean(result) || sending}
            />
          ) : (
            questions.map(question => (
              <Question
                key={question.id}
                question={question}
                chosen={choices[question.id] ?? null}
                onChoose={optionId => setChoices(prev => ({ ...prev, [question.id]: optionId }))}
                locked={Boolean(result) || sending}
                outcome={result?.results?.find(r => r.questionId === question.id) ?? null}
              />
            ))
          )}
          {result?.note && (
            <div
              className="rounded-[10px] border border-[var(--g-ally-edge)] bg-[var(--g-ally-wash)] px-4 py-3"
              data-testid="coach-note"
            >
              <p className="g-label text-[var(--g-ally-label)]">{t("guide.practice.note")}</p>
              <p className="g-prose mt-1 text-[var(--g-ink)]">{result.note}</p>
            </div>
          )}
          {practice?.status === "error" && (
            <p className="font-secondary text-sm text-[var(--g-ink)]" role="status">
              {practice.message ?? t("guide.practice.notSent")}
            </p>
          )}
        </div>
      )}
    </CardFrame>
  );
};

type ActivityQuestion = NonNullable<GuideMicroActivity["questions"]>[number];

const Question: FC<{
  question: ActivityQuestion;
  chosen: string | null;
  onChoose: (optionId: string) => void;
  locked: boolean;
  outcome: { correct: boolean; correctOptionId: string; feedback: string } | null;
}> = ({ question, chosen, onChoose, locked, outcome }) => {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2" data-testid={`question-${question.id}`}>
      <legend className="mb-2 font-secondary text-base font-semibold text-[var(--g-ink)]">
        {question.prompt}
      </legend>
      {question.options.map(option => {
        const mine = chosen === option.id;
        const theirs = outcome?.correctOptionId === option.id;
        const mark = outcome
          ? mine && theirs
            ? t("guide.practice.yoursAndCourse")
            : theirs
              ? t("guide.practice.courseAnswer")
              : mine
                ? t("guide.practice.yourAnswer")
                : null
          : null;
        return (
          <label
            key={option.id}
            className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border px-4 py-2 font-secondary text-base text-[var(--g-ink)] ${
              theirs
                ? "border-[var(--g-ink)]"
                : mine
                  ? "border-[var(--g-ally-edge)]"
                  : "border-[var(--g-line)]"
            } ${locked ? "cursor-default" : "hover:border-[var(--g-ink-faint)]"}`}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={mine}
              disabled={locked}
              onChange={() => onChoose(option.id)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--g-action)]"
            />
            <span className="flex-1">
              {option.text}
              {mark && (
                <span className="g-caption mt-0.5 block" data-testid="option-mark">
                  {theirs ? "✓ " : ""}
                  {mark}
                </span>
              )}
            </span>
          </label>
        );
      })}
      {outcome?.feedback && (
        <p className="g-prose mt-1 text-[var(--g-ink-soft)]" data-testid="question-feedback">
          {outcome.feedback}
        </p>
      )}
    </fieldset>
  );
};

const WrittenAnswer: FC<{
  activity: GuideMicroActivity;
  text: string;
  onChange: (text: string) => void;
  locked: boolean;
}> = ({ activity, text, onChange, locked }) => {
  const { t } = useTranslation();
  const id = useId();
  const remaining = MESSAGE_MAX_CHARS - text.length;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-secondary text-base font-semibold text-[var(--g-ink)]">
        {activity.prompt ?? t(`guide.practice.kind.${activity.kind}`)}
      </label>
      <textarea
        id={id}
        rows={3}
        value={text}
        readOnly={locked}
        onChange={event => onChange(event.target.value)}
        placeholder={activity.placeholder ?? t("guide.practice.placeholder")}
        aria-invalid={remaining < 0}
        className="min-h-24 w-full resize-y rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-3 py-2 font-secondary text-[17px] leading-6 text-[var(--g-ink)] outline-none placeholder:text-[var(--g-ink-faint)] focus:border-[var(--g-ink-faint)]"
      />
      {remaining < 200 && (
        <p className="g-caption" aria-live="polite">
          {remaining < 0
            ? t("guide.composer.tooLong", { max: MESSAGE_MAX_CHARS.toLocaleString() })
            : t("guide.composer.left", { count: remaining })}
        </p>
      )}
    </div>
  );
};

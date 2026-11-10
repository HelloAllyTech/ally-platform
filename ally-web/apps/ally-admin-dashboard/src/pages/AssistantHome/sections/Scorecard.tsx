import React, { useState } from "react";

import {
  type Scorecard as ScorecardView,
  type WeekStats,
  useAnswerUnansweredMutation,
  useCorrectFeedbackMutation,
  useGetScorecardQuery,
  useMarkFeedbackFineMutation,
} from "@api";
import { Button } from "@components/v2";

import { Sparkline } from "../../Analytics/chartKit";
import { COPY } from "../../Onboarding/copy";
import { fill, HOME } from "../copy";
import { Group } from "../fields";

import type { SectionId } from "../sections";

const t = HOME.scorecard;

type Measure = { label: string; value: (w: WeekStats) => string; extra?: string };

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

/** The six numbers, as the deck names them, each with last week's in grey. */
const MEASURES: Measure[] = [
  { label: t.labels.conversations, value: w => w.conversations.toLocaleString("en-IN") },
  { label: t.labels.answered, value: w => pct(w.answers ? w.answeredPct : null) },
  { label: t.labels.unknown, value: w => w.declined.toLocaleString("en-IN") },
  { label: t.labels.handedOver, value: w => w.handedOver.toLocaleString("en-IN") },
  { label: t.labels.thumbsUp, value: w => pct(w.thumbsUpPct) },
  { label: t.labels.safety, value: w => w.crisis.toLocaleString("en-IN") },
];

/** The owner's answer, written in place: "Answer it" and "Correct this" both use it. */
const AnswerBox: React.FC<{
  busy: boolean;
  onSave: (text: string, addToCheckup: boolean) => Promise<boolean>;
  onCancel: () => void;
}> = ({ busy, onSave, onCancel }) => {
  const [text, setText] = useState("");
  // "Also add to checkup" (chunk 20d-2), ticked by default.
  const [addToCheckup, setAddToCheckup] = useState(true);
  const id = React.useId();
  return (
    <form
      className="ally-field ally-score__answer"
      onSubmit={async event => {
        event.preventDefault();
        if (text.trim() && (await onSave(text.trim(), addToCheckup))) setText("");
      }}
    >
      <label className="ally-field__label" htmlFor={id}>
        {t.yourAnswer}
      </label>
      <textarea
        id={id}
        className="ally-input"
        rows={3}
        maxLength={1000}
        placeholder={t.answerPlaceholder}
        value={text}
        onChange={event => setText(event.target.value)}
      />
      <label className="ally-home__check">
        <input
          type="checkbox"
          checked={addToCheckup}
          onChange={event => setAddToCheckup(event.target.checked)}
        />
        <span>{HOME.checkupControls.alsoAdd}</span>
      </label>
      <div className="ally-btn-row">
        <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
          {t.save}
        </Button>
        <Button onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  );
};

/**
 * How it's doing with real people, this week (chunk Q2a): the plain-words headline, six numbers
 * against last week, the 7-day trend, the questions it didn't know (Answer it) and the answers
 * people weren't happy with (Correct this · It was fine), and the last checkup.
 */
/** A card's place while its numbers load (chunk 20d-2), so the page doesn't jump. */
const CardSkeleton: React.FC<{ height: number }> = ({ height }) => (
  <div className="ally-card ally-home__skeleton-card" style={{ height }} aria-hidden="true" />
);

/**
 * "Questions it didn't know" (chunk Q2a), each with Answer it. On the Overview and, the same list,
 * in What it knows (chunk 20d-2), so the two never disagree.
 */
export const UnansweredList: React.FC<{ botId: string; canEdit: boolean; testId?: string }> = ({
  botId,
  canEdit,
  testId = "overview-unanswered",
}) => {
  const { data } = useGetScorecardQuery(botId);
  const [answer, answering] = useAnswerUnansweredMutation();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data) return <CardSkeleton height={180} />;
  return (
    <Group title={t.unansweredTitle} testId={testId}>
      {data.unanswered.length === 0 ? (
        <p className="ally-empty">{t.noUnanswered}</p>
      ) : (
        <ul className="ally-score__list">
          {data.unanswered.map(q => (
            <li key={q.id}>
              <div className="ally-home__row">
                <p className="ally-body">“{q.question}”</p>
                {canEdit && open !== q.id && (
                  <Button onClick={() => setOpen(q.id)}>{t.answerIt}</Button>
                )}
              </div>
              {open === q.id && (
                <AnswerBox
                  busy={answering.isLoading}
                  onCancel={() => setOpen(null)}
                  onSave={async (text, addToCheckup) => {
                    setError(null);
                    try {
                      await answer({ id: botId, questionId: q.id, text, addToCheckup }).unwrap();
                      setOpen(null);
                      setNote(t.saved);
                      return true;
                    } catch {
                      setError(COPY.problems.generic);
                      return false;
                    }
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
    </Group>
  );
};

export const Scorecard: React.FC<{
  botId: string;
  canEdit: boolean;
  go: (id: SectionId) => void;
}> = ({ botId, canEdit, go }) => {
  const { data } = useGetScorecardQuery(botId);
  const [correct, correcting] = useCorrectFeedbackMutation();
  const [fine, finishing] = useMarkFeedbackFineMutation();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data) {
    // This week, the two lists and the checkup card, at about their final size.
    return (
      <>
        <CardSkeleton height={440} />
        <CardSkeleton height={180} />
        <CardSkeleton height={180} />
      </>
    );
  }

  const save = async (run: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await run();
      setOpen(null);
      setNote(t.saved);
      return true;
    } catch {
      setError(COPY.problems.generic);
      return false;
    }
  };

  return (
    <>
      <Group title={t.thisWeek} testId="overview-this-week">
        {data.thisWeek.conversations === 0 ? (
          <p className="ally-empty">{t.empty}</p>
        ) : (
          <Headline
            view={data}
            onUnknown={() =>
              document
                .querySelector('[data-testid="overview-unanswered"]')
                ?.scrollIntoView?.({ behavior: "smooth", block: "start" })
            }
          />
        )}
        <dl className="ally-home__stats ally-score__stats">
          {MEASURES.map(m => (
            <div key={m.label} className="ally-home__stat">
              <dt className="ally-small">{m.label}</dt>
              <dd>
                {m.value(data.thisWeek)}
                <span className="ally-small ally-score__last">
                  {fill(t.vsLastWeek, { value: m.value(data.lastWeek) })}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        {data.thisWeek.wrongDeclineSuspected > 0 && (
          <p className="ally-small">
            {t.labels.unknown}: {fill(t.suspected, { n: data.thisWeek.wrongDeclineSuspected })}
          </p>
        )}
        <div className="ally-score__trend">
          <span className="ally-small">{t.trend}</span>
          <Sparkline
            values={data.trend.map(d => d.answeredPct)}
            width={160}
            height={32}
            label={t.trend}
          />
        </div>
      </Group>

      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}

      <UnansweredList botId={botId} canEdit={canEdit} />

      <Group title={t.thumbsDownTitle} testId="overview-thumbs-down">
        {data.thumbsDown.length === 0 ? (
          <p className="ally-empty">{t.noThumbsDown}</p>
        ) : (
          <ul className="ally-score__list">
            {data.thumbsDown.map(f => (
              <li key={f.id} className="ally-score__unhappy">
                {f.question && (
                  <p className="ally-body">
                    <span className="ally-label">{t.theyAsked}</span> “{f.question}”
                  </p>
                )}
                <p className="ally-body">
                  <span className="ally-label">{t.itSaid}</span> {f.reply}
                </p>
                {(f.reason || f.note) && (
                  <p className="ally-small">
                    <span className="ally-label">{t.why}</span>{" "}
                    {[f.reason && t.reasons[f.reason], f.note].filter(Boolean).join(" · ")}
                  </p>
                )}
                {canEdit && open !== f.id && (
                  <div className="ally-btn-row">
                    <Button onClick={() => setOpen(f.id)}>{t.correct}</Button>
                    <Button
                      variant="ghost"
                      disabled={finishing.isLoading}
                      onClick={() =>
                        void save(() => fine({ id: botId, feedbackId: f.id }).unwrap()).then(() =>
                          setNote(null),
                        )
                      }
                    >
                      {t.fine}
                    </Button>
                  </div>
                )}
                {open === f.id && (
                  <AnswerBox
                    busy={correcting.isLoading}
                    onCancel={() => setOpen(null)}
                    onSave={(text, addToCheckup) =>
                      save(() =>
                        correct({ id: botId, feedbackId: f.id, text, addToCheckup }).unwrap(),
                      )
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Group>

      {data.checkup && (
        <Group testId="overview-checkup">
          <div className="ally-home__row">
            <p className="ally-body">
              {fill(t.checkupCard, { passed: data.checkup.passed, total: data.checkup.total })}
            </p>
            <Button onClick={() => go("checkup")}>{t.viewCheckup}</Button>
          </div>
        </Group>
      )}
    </>
  );
};

/** "This week: 142 conversations. 91% answered with a source. 12 questions it didn't know." */
const Headline: React.FC<{ view: ScorecardView; onUnknown: () => void }> = ({
  view,
  onUnknown,
}) => {
  const w = view.thisWeek;
  const text = fill(t.headline, {
    conversations: w.conversations.toLocaleString("en-IN"),
    answered_pct: `${w.answeredPct}%`,
    unknown: "\u0000",
  });
  const [before, after] = text.split("\u0000");
  return (
    <p className="ally-body ally-score__headline" data-testid="scorecard-headline">
      {before}
      <button type="button" className="ally-link" onClick={onUnknown}>
        {w.declined.toLocaleString("en-IN")}
      </button>
      {after}
    </p>
  );
};

import React, { useMemo, useState } from "react";

import { Button, PrimaryButton, Question } from "@components/v2";
import type {
  TemplateAnswers,
  TemplateCard,
  TemplateCatalogue,
  TemplateInstallResult,
} from "@types";

import { TEMPLATE_COPY as C, fillIn } from "./copy";
import { BUSINESS_TONES, Motif, TONES, hasMotif } from "../Login/Motifs";

import "./templates.css";

/**
 * Start from a template (T1): the cards in two groups, For organisations then For businesses,
 * the suggested one first; then the template's setup questions, each skippable. Used in setup
 * (before or after reading a website) and in Tools → Add from a template. What choosing does is
 * the caller's `onSubmit`.
 */
export const TemplateSetup: React.FC<{
  catalogue: TemplateCatalogue | undefined;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  /** Setup from nothing asks the business's name too. */
  askName?: boolean;
  busy?: boolean;
  error?: string | null;
  /** Tools: the line saying nothing the owner has is changed. */
  note?: string;
  onSubmit: (template: TemplateCard, answers: TemplateAnswers, name: string) => void;
  onBack?: () => void;
}> = ({ catalogue, loading, failed, onRetry, askName, busy, error, note, onSubmit, onBack }) => {
  const [chosen, setChosen] = useState<TemplateCard | null>(null);
  const [answers, setAnswers] = useState<TemplateAnswers>({});
  const [name, setName] = useState("");

  if (chosen) {
    return (
      <Question title={C.questionsTitle} subtitle={chosen.name} as="h2">
        <form
          className="ally-templates__form"
          onSubmit={event => {
            event.preventDefault();
            onSubmit(chosen, answers, name.trim());
          }}
        >
          {askName && (
            <label className="ally-templates__question">
              <span className="ally-templates__ask">{C.name}</span>
              <input
                className="ally-input"
                value={name}
                maxLength={120}
                onChange={event => setName(event.target.value)}
                autoFocus
              />
            </label>
          )}
          {chosen.setup.map(q => (
            <SetupQuestion
              key={q.key}
              ask={q.ask}
              hint={q.hint}
              kind={q.kind}
              choices={q.choices}
              value={answers[q.key]}
              onChange={value => {
                const next = { ...answers };
                if (value === undefined) delete next[q.key];
                else next[q.key] = value;
                setAnswers(next);
              }}
            />
          ))}
          {note && <p className="ally-small ally-templates__note">{note}</p>}
          {error && (
            <p className="ally-error" role="alert">
              {error}
            </p>
          )}
          <div className="ally-templates__actions">
            <Button variant="ghost" onClick={() => setChosen(null)} disabled={busy}>
              {C.back}
            </Button>
            <PrimaryButton type="submit" disabled={busy} data-testid="template-set-up">
              {C.setUp}
            </PrimaryButton>
          </div>
        </form>
      </Question>
    );
  }

  return (
    <Question title={C.title} as="h2">
      {loading && <p className="ally-small">{C.loading}</p>}
      {failed && (
        <div role="alert" className="ally-templates__failed">
          <p>{C.failed}</p>
          {onRetry && (
            <Button variant="ghost" onClick={onRetry}>
              {C.tryAgain}
            </Button>
          )}
        </div>
      )}
      {catalogue?.groups.map(group => (
        <section key={group.id} className="ally-templates__group" aria-label={group.name}>
          <h3 className="ally-templates__group-title">{group.name}</h3>
          <ul className="ally-templates__cards" data-testid={`template-group-${group.id}`}>
            {group.templates.map(card => (
              <li key={card.id}>
                <Card card={card} onChoose={() => setChosen(card)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {onBack && (
        <Button variant="ghost" onClick={onBack}>
          {C.back}
        </Button>
      )}
    </Question>
  );
};

const Card: React.FC<{ card: TemplateCard; onChoose: () => void }> = ({ card, onChoose }) => {
  // Organisation templates name their motif in `icon`; business ones carry an emoji there,
  // so their motif is keyed by template id.
  const artKey = card.group === "organisations" ? card.icon : card.id;
  const drawn = hasMotif(artKey);
  const tone = TONES[artKey] ?? BUSINESS_TONES[artKey];
  const lists = card.lists.map(l => l.name).join(", ");
  return (
    <button
      type="button"
      className="ally-templates__card ally-press"
      data-testid={`template-card-${card.id}`}
      onClick={onChoose}
    >
      <span
        className="ally-templates__art"
        aria-hidden="true"
        style={tone ? { background: tone.bg } : undefined}
      >
        {drawn ? (
          <Motif id={artKey} className="ally-templates__motif" />
        ) : (
          <span className="ally-templates__emoji">{card.icon}</span>
        )}
      </span>
      <span className="ally-templates__body">
        {card.suggested && <span className="ally-templates__badge">{C.suggested}</span>}
        <span className="ally-templates__name">{card.name}</span>
        <span className="ally-templates__line">{card.one_liner}</span>
        {lists && <span className="ally-small">{fillIn(C.setsUp, { lists })}</span>}
        {card.pack && <span className="ally-small">{fillIn(C.safety, { pack: card.pack })}</span>}
        <span className="ally-small">{fillIn(C.asks, { n: card.setup.length })}</span>
        <span className="ally-templates__use">{C.use} →</span>
      </span>
    </button>
  );
};

const SetupQuestion: React.FC<{
  ask: string;
  hint?: string;
  kind: TemplateCard["setup"][number]["kind"];
  choices?: string[];
  value: TemplateAnswers[string] | undefined;
  onChange: (value: TemplateAnswers[string] | undefined) => void;
}> = ({ ask, hint, kind, choices, value, onChange }) => {
  const id = useMemo(() => `t-${Math.random().toString(36).slice(2, 9)}`, []);
  const skipped = value === undefined || value === "" || (Array.isArray(value) && !value.length);
  return (
    <fieldset className="ally-templates__question">
      <legend className="ally-templates__ask" id={id}>
        {ask}
      </legend>
      {hint && <span className="ally-small">{hint}</span>}
      {kind === "yes_no" ? (
        <div className="ally-templates__choices" role="radiogroup" aria-labelledby={id}>
          {[
            { label: C.yes, v: true },
            { label: C.no, v: false },
          ].map(option => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={value === option.v}
              className={`ally-templates__choice${value === option.v ? " is-on" : ""}`}
              onClick={() => onChange(value === option.v ? undefined : option.v)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : kind === "choices" ? (
        <div className="ally-templates__choices" role="group" aria-labelledby={id}>
          {(choices ?? []).map(choice => {
            const picked = Array.isArray(value) ? value : [];
            const on = picked.includes(choice);
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={on}
                className={`ally-templates__choice${on ? " is-on" : ""}`}
                onClick={() =>
                  onChange(on ? picked.filter(c => c !== choice) : [...picked, choice])
                }
              >
                {choice}
              </button>
            );
          })}
        </div>
      ) : kind === "phone" ? (
        <input
          className="ally-input"
          aria-labelledby={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={40}
          value={typeof value === "string" ? value : ""}
          onChange={event => onChange(event.target.value)}
        />
      ) : kind === "text" ? (
        <input
          className="ally-input"
          aria-labelledby={id}
          maxLength={2000}
          value={typeof value === "string" ? value : ""}
          onChange={event => onChange(event.target.value)}
        />
      ) : (
        <textarea
          className="ally-input"
          aria-labelledby={id}
          rows={3}
          maxLength={2000}
          value={typeof value === "string" ? value : ""}
          onChange={event => onChange(event.target.value)}
        />
      )}
      {skipped && <span className="ally-small ally-templates__skip">{C.skipNote}</span>}
    </fieldset>
  );
};

/** What a template did, in the owner's words: added, kept, the pack, the checkup. */
export const TemplateResult: React.FC<{
  result: TemplateInstallResult;
  onRunCheckup?: () => void;
  onDone: () => void;
}> = ({ result, onRunCheckup, onDone }) => {
  const lines: string[] = [];
  if (result.added.length) lines.push(fillIn(C.result.added, { lists: result.added.join(", ") }));
  for (const list of result.skipped) lines.push(fillIn(C.result.kept, { list }));
  if (result.pack.outcome === "raised") {
    lines.push(fillIn(C.result.packRaised, { pack: result.pack.pack }));
  } else if (result.pack.outcome === "kept") {
    lines.push(fillIn(C.result.packKept, { "current pack": result.pack.pack }));
  } else if (result.pack.outcome === "cant_combine") {
    lines.push(result.pack.message);
  }
  if (result.checkups) lines.push(fillIn(C.result.checkups, { n: result.checkups }));
  return (
    <div className="ally-card ally-templates__result" data-testid="template-result" role="status">
      <h3 className="ally-templates__group-title">{result.template.name}</h3>
      <ul>
        {lines.map(line => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="ally-templates__actions">
        {onRunCheckup && result.checkups > 0 && (
          <Button variant="ghost" onClick={onRunCheckup}>
            {C.result.runCheckup}
          </Button>
        )}
        <PrimaryButton onClick={onDone}>{C.result.done}</PrimaryButton>
      </div>
    </div>
  );
};

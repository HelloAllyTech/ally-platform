import React, { useEffect, useRef, useState } from "react";

import { useInstallReadyMadeListMutation, useUpdateListFieldMutation } from "@api";
import { Button, ProgressBar } from "@components/v2";
import type { Chatbot, ReadyMadeCatalogue, ReadyMadeItem, UserList } from "@types";

import { HOME, fill } from "../copy";
import { AssistantBlock } from "./AssistantBlock";
import { datedField, human, lower } from "./format";
import { RepeatWeekly } from "./RepeatWeekly";

const t = () => HOME.userLists;

type Step = "choose" | "yours" | "times" | "assistant" | "tryIt";

/**
 * Start from a ready-made list (chunk 5b): a short guided setup, like onboarding. Choose installs
 * the list (and the one it books into) with no entries; every step after that can be skipped:
 * replace the example choices, add times with Repeat weekly, choose what the assistant may do, then
 * try it.
 */
export const ReadyMadeSetup: React.FC<{
  bot: Chatbot;
  catalogue: ReadyMadeCatalogue;
  lists: UserList[];
  onClose: (openKey?: string) => void;
  tryIt?: (question?: string) => void;
}> = ({ bot, catalogue, lists, onClose, tryIt }) => {
  const [item, setItem] = useState<ReadyMadeItem | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [step, setStep] = useState<Step>("choose");
  const heading = useRef<HTMLHeadingElement>(null);

  // The lists as they are now (the section refetches them after each change).
  const mine = installed.map(key => lists.find(l => l.key === key)).filter(Boolean) as UserList[];
  const main = mine[mine.length - 1] ?? null;
  const dated = mine.find(l => datedField(l));
  const steps: Step[] = [
    "choose",
    ...(item?.needs_options.length ? (["yours"] as const) : []),
    ...(item && (dated || item.lists.some(l => l.fields.some(f => f.type === "datetime")))
      ? (["times"] as const)
      : []),
    "assistant",
    ...(tryIt ? (["tryIt"] as const) : []),
  ];
  const at = steps.indexOf(step);
  // Before a list is chosen, count the longest setup; it shortens once the list is known.
  const total = item ? steps.length : 4 + (tryIt ? 1 : 0);
  const next = () => {
    const following = steps[at + 1];
    if (following) setStep(following);
    else onClose(main?.key);
  };
  const back = () => setStep(steps[Math.max(0, at - 1)]);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  return (
    <div className="ally-setup" data-testid="ready-made-setup">
      <div className="ally-setup__top">
        <span className="ally-label">
          {fill(t().setup.step, { n: at + 1, total })} · {t().setup.steps[step]}
        </span>
        <Button variant="ghost" onClick={() => onClose(main?.key)}>
          {t().setup.close}
        </Button>
      </div>
      <ProgressBar value={((at + 1) / total) * 100} label={t().setup.title} />

      {step === "choose" && (
        <Choose
          bot={bot}
          catalogue={catalogue}
          lists={lists}
          heading={heading}
          onInstalled={(chosen, keys) => {
            setItem(chosen);
            setInstalled(keys);
            const remaining: Step[] = [
              ...(chosen.needs_options.length ? (["yours"] as const) : []),
              ...(chosen.lists.some(l => l.fields.some(f => f.type === "datetime"))
                ? (["times"] as const)
                : []),
              "assistant",
            ];
            setStep(remaining[0]);
          }}
        />
      )}

      {step === "yours" && item && (
        <MakeItYours
          bot={bot}
          item={item}
          lists={mine}
          heading={heading}
          onNext={next}
          onBack={back}
        />
      )}

      {step === "times" && dated && (
        <section className="ally-setup__step">
          <h2 ref={heading} tabIndex={-1} className="ally-setup__title">
            {t().setup.timesTitle}
          </h2>
          <p className="ally-setup__body">{t().setup.timesBody}</p>
          <div className="ally-card">
            <RepeatWeekly
              bot={bot}
              lists={lists}
              list={dated}
              field={datedField(dated)!}
              onDone={next}
            />
          </div>
          <StepButtons onBack={back} onSkip={next} skipLabel={t().setup.skipForNow} />
        </section>
      )}

      {step === "assistant" && main && (
        <section className="ally-setup__step">
          <h2 ref={heading} tabIndex={-1} className="ally-setup__title">
            {fill(t().setup.assistantTitle, { list: main.name })}
          </h2>
          <p className="ally-setup__body">{t().setup.assistantBody}</p>
          <div className="ally-card">
            <AssistantBlock botId={bot.id} list={main} lists={lists} canEdit />
          </div>
          <StepButtons onBack={back} onSkip={next} onNext={next} />
        </section>
      )}

      {step === "tryIt" && item && (
        <section className="ally-setup__step">
          <h2 ref={heading} tabIndex={-1} className="ally-setup__title">
            {t().setup.tryTitle}
          </h2>
          <p className="ally-setup__body">{t().setup.tryBody}</p>
          <div className="ally-card ally-setup__try">
            <p className="ally-setup__question">“{item.examples[0]}”</p>
            <Button variant="primary" onClick={() => tryIt?.(item.examples[0])}>
              {t().setup.tryOpen}
            </Button>
          </div>
          <div className="ally-setup__buttons">
            <Button onClick={back}>{t().setup.back}</Button>
            <Button variant="primary" onClick={() => onClose(main?.key)}>
              {fill(t().setup.finish, { list: main?.name ?? "" })}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
};

/** Back, Skip and Next. Without `onNext` the step's own action moves on (Add them). */
const StepButtons: React.FC<{
  onBack: () => void;
  onSkip: () => void;
  onNext?: () => void;
  skipLabel?: string;
}> = ({ onBack, onSkip, onNext, skipLabel }) => (
  <div className="ally-setup__buttons">
    <Button onClick={onBack}>{t().setup.back}</Button>
    <span className="ally-setup__spacer" />
    <Button variant="ghost" onClick={onSkip}>
      {skipLabel ?? t().setup.skip}
    </Button>
    {onNext && (
      <Button variant="primary" onClick={onNext}>
        {t().setup.next}
      </Button>
    )}
  </div>
);

/** Choose: the catalogue as cards, grouped, with what people can ask and what it keeps. */
const Choose: React.FC<{
  bot: Chatbot;
  catalogue: ReadyMadeCatalogue;
  lists: UserList[];
  heading: React.RefObject<HTMLHeadingElement>;
  onInstalled: (item: ReadyMadeItem, keys: string[]) => void;
}> = ({ bot, catalogue, lists, heading, onInstalled }) => {
  const [install, { isLoading }] = useInstallReadyMadeListMutation();
  const [picked, setPicked] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const have = (item: ReadyMadeItem) => item.lists.some(l => lists.some(x => x.key === l.key));

  const use = async (item: ReadyMadeItem) => {
    setPicked(item.name);
    setFailed(null);
    try {
      const { lists: made } = await install({ id: bot.id, name: item.name }).unwrap();
      onInstalled(
        item,
        made.map(l => l.key),
      );
    } catch {
      setFailed(item.name);
    }
  };

  return (
    <section className="ally-setup__step">
      <h2 ref={heading} tabIndex={-1} className="ally-setup__title">
        {t().setup.title}
      </h2>
      {catalogue.groups.map(group => (
        <div key={group.name} className="ally-setup__group">
          <h3 className="ally-label">{group.name}</h3>
          <ul className="ally-setup__cards">
            {group.items.map(item => {
              const own = have(item);
              const main = item.lists[item.lists.length - 1];
              const partner = item.lists.length > 1 ? item.lists[0] : null;
              return (
                <li key={item.name} className={`ally-card ally-setup__card${own ? " is-had" : ""}`}>
                  <div className="ally-setup__card-head">
                    <h4 className="ally-setup__card-title">{item.title}</h4>
                    {partner && (
                      <span className="ally-setup__badge">
                        {fill(t().setup.comesWith, { list: partner.name })}
                      </span>
                    )}
                  </div>
                  <p className="ally-small">{item.one_liner}</p>
                  {item.examples.length > 0 && (
                    <div className="ally-setup__asks">
                      <span className="ally-setup__mini">{t().setup.peopleAsk}</span>
                      <ul>
                        {item.examples.slice(0, 3).map(q => (
                          <li key={q}>“{q}”</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="ally-setup__keeps">
                    <span className="ally-setup__mini">{t().setup.keeps}</span>
                    <p className="ally-small">{main.fields.map(f => f.label).join(" · ")}</p>
                  </div>
                  {failed === item.name && (
                    <p className="ally-error" role="alert">
                      {t().setup.failed}
                    </p>
                  )}
                  <div className="ally-setup__card-foot">
                    {own ? (
                      <span className="ally-small">{t().setup.have}</span>
                    ) : (
                      <Button
                        variant="primary"
                        disabled={isLoading}
                        aria-label={`${t().setup.use}: ${item.title}`}
                        onClick={() => void use(item)}
                      >
                        {isLoading && picked === item.name ? t().setup.adding : t().setup.use}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
};

/** Make it yours: the example choices as chips, marked as examples, to replace with the owner's own. */
const MakeItYours: React.FC<{
  bot: Chatbot;
  item: ReadyMadeItem;
  lists: UserList[];
  heading: React.RefObject<HTMLHeadingElement>;
  onNext: () => void;
  onBack: () => void;
}> = ({ bot, item, lists, heading, onNext, onBack }) => {
  const need = item.needs_options[0];
  const list = lists.find(l => l.key === need.list);
  const [values, setValues] = useState<string[]>(need.examples);
  const [examples, setExamples] = useState<string[]>(need.examples);
  const [typed, setTyped] = useState("");
  const [save, { isLoading }] = useUpdateListFieldMutation();
  const [failed, setFailed] = useState(false);

  const addOne = () => {
    const v = typed.trim();
    if (v && !values.includes(v)) setValues([...values, v]);
    setTyped("");
  };

  const next = async () => {
    setFailed(false);
    try {
      if (list && JSON.stringify(values) !== JSON.stringify(need.examples)) {
        await save({
          id: bot.id,
          key: list.key,
          field: need.field,
          change: { options: { values } },
        }).unwrap();
      }
      onNext();
    } catch {
      setFailed(true);
    }
  };

  return (
    <section className="ally-setup__step">
      <h2 ref={heading} tabIndex={-1} className="ally-setup__title">
        {fill(t().setup.yoursTitle, { list: list?.name ?? item.title })}
      </h2>
      <p className="ally-setup__body">{fill(t().setup.yoursBody, { detail: lower(need.label) })}</p>
      <div className="ally-card">
        <fieldset className="ally-field">
          <legend className="ally-field__label">{need.label}</legend>
          <div className="ally-chips" data-testid="choices">
            {values.map(value => (
              <span
                key={value}
                className={`ally-choice${examples.includes(value) ? " is-example" : ""}`}
              >
                {human(value)}
                {examples.includes(value) && (
                  <span className="ally-choice__tag">{t().setup.example}</span>
                )}
                <button
                  type="button"
                  aria-label={fill(t().details.removeChoice, { value: human(value) })}
                  disabled={values.length === 1}
                  onClick={() => {
                    setValues(values.filter(v => v !== value));
                    setExamples(examples.filter(v => v !== value));
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="ally-details__add-choice">
            <input
              className="ally-input"
              aria-label={fill(t().setup.choicePlaceholder, { detail: lower(need.label) })}
              placeholder={fill(t().setup.choicePlaceholder, { detail: lower(need.label) })}
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOne();
                }
              }}
            />
            <Button onClick={addOne}>{t().setup.addChoice}</Button>
          </div>
          {values.length === 1 && <p className="ally-field__hint">{t().setup.needOne}</p>}
        </fieldset>
      </div>
      {failed && (
        <p className="ally-error" role="alert">
          {t().form.failed}
        </p>
      )}
      <div className="ally-setup__buttons">
        <Button onClick={onBack}>{t().setup.back}</Button>
        <span className="ally-setup__spacer" />
        <Button variant="ghost" onClick={onNext}>
          {t().setup.skip}
        </Button>
        <Button variant="primary" disabled={isLoading} onClick={() => void next()}>
          {isLoading ? t().form.saving : t().setup.next}
        </Button>
      </div>
    </section>
  );
};

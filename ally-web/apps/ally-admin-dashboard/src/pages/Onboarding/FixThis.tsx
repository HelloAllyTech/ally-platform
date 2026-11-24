import React, { useEffect, useRef, useState } from "react";

import { useAddCheckupCaseMutation } from "@api";
import { Button } from "@components/v2";

import { SPLIT_COPY, fill } from "./copy";
import {
  FACT_MAX_CHARS,
  RULE_MAX_COUNT,
  TOPIC_MAX_CHARS,
  addFactPatch,
  avoidTopicPatch,
  closestFacts,
  correctFactPatch,
  factText,
  isAllowedFixPatch,
  tonePatch,
} from "./fixPatches";
import { TONES } from "./MakeItYours";
import { ACCEPTED_FILES } from "./useDraftUpload";

import type { FixPatch } from "./fixPatches";
import type { BotDraftView, PatchOp } from "./types";

const F = SPLIT_COPY.fix;
const A = SPLIT_COPY.addFact;
const S = SPLIT_COPY.saveTest;

/** What the pane needs from the onboarding session to change the draft. */
export interface FixTools {
  edit: (target: "draft" | "learned", ops: PatchOp[]) => Promise<boolean>;
  upload: (files: File[]) => Promise<boolean>;
}

/** Sends a patch only if it is one of the allowed ones. */
const sendPatch = (tools: FixTools, patch: FixPatch): Promise<boolean> =>
  isAllowedFixPatch(patch.target, patch.ops)
    ? tools.edit(patch.target, patch.ops)
    : Promise.resolve(false);

/** Add a fact: the owner's own answer, saved as a detail "From you". */
export const AddFactBox: React.FC<{
  id: string;
  question: string;
  tools: FixTools;
  onDone: () => void;
  /** Inside the fix panel there is no heading. */
  bare?: boolean;
}> = ({ id, question, tools, onDone, bare }) => {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const length = question.trim() && answer.trim() ? factText(question, answer).length : 0;
  const over = length - FACT_MAX_CHARS;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!answer.trim() || over > 0 || busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await sendPatch(tools, addFactPatch(question, answer));
    setBusy(false);
    if (ok) {
      setAnswer("");
      onDone();
    } else setFailed(true);
  };
  return (
    <form className="ally-dt__addfact" id={`ally-dt-addfact-${id}`} onSubmit={submit}>
      {!bare && <p className="ally-small ally-dt__addfact-head">{A.heading}</p>}
      <label className="ally-field__label" htmlFor={`ally-dt-addfact-text-${id}`}>
        {A.label}
      </label>
      <textarea
        id={`ally-dt-addfact-text-${id}`}
        className="ally-input"
        rows={3}
        value={answer}
        onChange={event => setAnswer(event.target.value)}
      />
      {length > 0 && (
        <p className="ally-small" role={over > 0 ? "alert" : undefined}>
          {over > 0
            ? fill(A.over, { n: length, over, max: FACT_MAX_CHARS })
            : fill(A.count, { n: length, max: FACT_MAX_CHARS })}
        </p>
      )}
      {failed && (
        <p className="ally-small" role="alert">
          {A.failed}
        </p>
      )}
      <div>
        <Button type="submit" variant="secondary" disabled={busy || !answer.trim() || over > 0}>
          {A.add}
        </Button>
      </div>
    </form>
  );
};

type Choice = "correct" | "avoid" | "tone" | "page";

/** "Fix this": a small inline panel of ways to change what the assistant knows or how it speaks. */
export const FixPanel: React.FC<{
  id: string;
  question: string;
  view: BotDraftView;
  tools: FixTools;
  onFixed: () => void;
  onClose: () => void;
}> = ({ id, question, view, tools, onFixed, onClose }) => {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [factPick, setFactPick] = useState<number | "new" | null>(null);
  const [factEdit, setFactEdit] = useState("");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]["id"]>("warm");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const facts = view.learned?.facts ?? [];
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);

  const rules = view.draft.extraNever ?? [];
  const rulesFull = rules.length >= RULE_MAX_COUNT;

  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    setFailed(false);
    const ok = await action();
    setBusy(false);
    if (ok) onFixed();
    else setFailed(true);
  };

  const options: { id: Choice; label: string }[] = [
    { id: "correct", label: F.correct },
    { id: "avoid", label: F.avoid },
    { id: "tone", label: F.tone },
    { id: "page", label: F.page },
  ];
  const near = closestFacts(question, facts);
  const factOver = factEdit.length > FACT_MAX_CHARS;
  const saveLabel = busy ? F.saving : F.save;

  return (
    <div
      role="region"
      aria-label={F.panel}
      className="ally-dt__fix"
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="ally-dt__fix-head">
        <strong className="ally-small">{F.panel}</strong>
        <button ref={close} type="button" className="ally-dt__link" onClick={onClose}>
          {F.close}
        </button>
      </div>
      <div role="radiogroup" aria-label={F.choicesLabel} className="ally-dt__choices">
        {options.map(option => (
          <label key={option.id} className="ally-dt__choice">
            <input
              type="radio"
              name={`fix-choice-${id}`}
              checked={choice === option.id}
              onChange={() => {
                setChoice(option.id);
                setFailed(false);
              }}
            />
            {option.label}
          </label>
        ))}
      </div>

      {choice === "correct" && (
        <div className="ally-dt__fix-body">
          <div role="radiogroup" aria-label={F.factsLabel} className="ally-dt__choices">
            {near.map(({ fact, index }) => (
              <label key={fact.id} className="ally-dt__choice">
                <input
                  type="radio"
                  name={`fix-fact-${id}`}
                  checked={factPick === index}
                  onChange={() => {
                    setFactPick(index);
                    setFactEdit(fact.text);
                    setFailed(false);
                  }}
                />
                {fact.text}
              </label>
            ))}
            <label className="ally-dt__choice">
              <input
                type="radio"
                name={`fix-fact-${id}`}
                checked={factPick === "new"}
                onChange={() => setFactPick("new")}
              />
              {F.addNew}
            </label>
          </div>
          {typeof factPick === "number" && (
            <form
              className="ally-dt__fix-body"
              onSubmit={event => {
                event.preventDefault();
                if (!factEdit.trim() || factOver || busy) return;
                void run(() => sendPatch(tools, correctFactPatch(factPick, factEdit)));
              }}
            >
              <label className="ally-field__label" htmlFor={`fix-fact-text-${id}`}>
                {F.factEdit}
              </label>
              <textarea
                id={`fix-fact-text-${id}`}
                className="ally-input"
                rows={3}
                value={factEdit}
                onChange={event => setFactEdit(event.target.value)}
              />
              {factOver && (
                <p className="ally-small" role="alert">
                  {fill(F.tooLong, { n: factEdit.length, max: FACT_MAX_CHARS })}
                </p>
              )}
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || !factEdit.trim() || factOver}
                >
                  {saveLabel}
                </Button>
              </div>
            </form>
          )}
          {factPick === "new" && (
            <AddFactBox id={`fix-${id}`} question={question} tools={tools} onDone={onFixed} bare />
          )}
        </div>
      )}

      {choice === "avoid" && (
        <form
          className="ally-dt__fix-body"
          onSubmit={event => {
            event.preventDefault();
            if (!topic.trim() || rulesFull || busy) return;
            void run(() => sendPatch(tools, avoidTopicPatch(topic)));
          }}
        >
          <label className="ally-field__label" htmlFor={`fix-topic-${id}`}>
            {F.avoidLabel}
          </label>
          <input
            id={`fix-topic-${id}`}
            className="ally-input"
            value={topic}
            maxLength={TOPIC_MAX_CHARS}
            disabled={rulesFull}
            onChange={event => setTopic(event.target.value)}
          />
          {rulesFull && (
            <p className="ally-small" role="alert">
              {fill(F.rulesFull, { n: RULE_MAX_COUNT })}
            </p>
          )}
          <div>
            <Button type="submit" variant="primary" disabled={busy || rulesFull || !topic.trim()}>
              {saveLabel}
            </Button>
          </div>
        </form>
      )}

      {choice === "tone" && (
        <form
          className="ally-dt__fix-body"
          onSubmit={event => {
            event.preventDefault();
            if (!busy) void run(() => sendPatch(tools, tonePatch(tone)));
          }}
        >
          <div role="radiogroup" aria-label={F.toneLabel} className="ally-dt__choices">
            {TONES.map(t => (
              <label key={t.id} className="ally-dt__choice">
                <input
                  type="radio"
                  name={`fix-tone-${id}`}
                  checked={tone === t.id}
                  onChange={() => setTone(t.id)}
                />
                {t.label}
              </label>
            ))}
          </div>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {saveLabel}
            </Button>
          </div>
        </form>
      )}

      {choice === "page" && (
        <div className="ally-dt__fix-body">
          <p className="ally-small">{F.pageHint}</p>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={ACCEPTED_FILES}
            data-testid="fix-page-file"
            onChange={event => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) void run(() => tools.upload(files));
            }}
          />
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {F.pageChoose}
            </Button>
          </div>
        </div>
      )}

      {failed && (
        <p className="ally-small" role="alert">
          {F.failed}
        </p>
      )}
    </div>
  );
};

/** "Save as a test": adds the question to the owner's checkup, once per reply. */
export const SaveAsTest: React.FC<{ chatbotId: string; question: string }> = ({
  chatbotId,
  question,
}) => {
  const [add] = useAddCheckupCaseMutation();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (outcome: "answer" | "dont_know") => {
    setBusy(true);
    setFailed(false);
    try {
      await add({
        id: chatbotId,
        input: { question, outcome, addedFrom: "chat" },
      }).unwrap();
      setSaved(true);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" disabled={saved} onClick={() => setOpen(o => !o)}>
        {S.button}
      </Button>
      {open && !saved && (
        <div
          role="group"
          aria-label={S.choicesLabel}
          className="ally-dt__fix"
          onKeyDown={event => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <Button variant="secondary" disabled={busy} onClick={() => void save("answer")}>
            {S.answer}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void save("dont_know")}>
            {S.dontKnow}
          </Button>
        </div>
      )}
      {saved && (
        <p className="ally-small" role="status">
          {fill(S.saved, { question })}
        </p>
      )}
      {failed && (
        <p className="ally-small" role="alert">
          {S.failed}
        </p>
      )}
    </>
  );
};

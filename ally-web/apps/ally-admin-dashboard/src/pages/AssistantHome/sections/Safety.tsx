import React, { useId, useState } from "react";

import { useChangeOwnRuleMutation } from "@api";
import { Button, SafetyCard } from "@components/v2";
import type { RuleChange, SafetyRule } from "@types";

import { COPY, fill } from "../../Onboarding/copy";
import { HOME } from "../copy";
import { Group, SectionHead, TextField } from "../fields";
import { useHomeField } from "../useHomeField";

import type { SectionProps } from "./props";

const t = HOME.safety;

const message = (error: unknown): string | undefined => {
  const data = (error as { data?: { message?: unknown } })?.data;
  return typeof data?.message === "string" ? data.message : undefined;
};

/** One of the owner's own rules: its text, Edit and Remove. */
const OwnRule: React.FC<{
  rule: SafetyRule;
  canEdit: boolean;
  busy: boolean;
  onChange: (change: RuleChange) => Promise<boolean>;
}> = ({ rule, canEdit, busy, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(rule.text);
  const id = useId();
  return (
    <li className="ally-home__rule" data-testid={`rule-${rule.id}`}>
      {editing ? (
        <form
          className="ally-home__rule-form"
          onSubmit={async event => {
            event.preventDefault();
            if (await onChange({ op: "edit", id: rule.id, text: value })) setEditing(false);
          }}
        >
          <label htmlFor={id} className="ally-sr-only">
            {t.edit}
          </label>
          <input
            id={id}
            className="ally-input"
            value={value}
            autoFocus
            maxLength={200}
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
            {COPY.learned.save}
          </Button>
          <Button onClick={() => setEditing(false)}>{COPY.learned.cancel}</Button>
        </form>
      ) : (
        <>
          <span className="ally-home__rule-text">{rule.text}</span>
          {canEdit && (
            <span className="ally-home__rule-actions">
              <button
                type="button"
                className="ally-link"
                aria-label={`${t.edit}: ${rule.text}`}
                onClick={() => {
                  setValue(rule.text);
                  setEditing(true);
                }}
              >
                {t.edit}
              </button>
              <button
                type="button"
                className="ally-link"
                aria-label={`${t.remove}: ${rule.text}`}
                disabled={busy}
                onClick={() => void onChange({ op: "remove", id: rule.id })}
              >
                {t.remove}
              </button>
            </span>
          )}
        </>
      )}
    </li>
  );
};

/**
 * Rules the assistant always follows (chunk 20d): the safety pack (fixed), the owner's own rules on
 * top, the disclaimer before every chat, and what it says when someone may be at risk. A pack rule
 * has no Edit or Remove; the server refuses both anyway.
 */
export const SafetySection: React.FC<SectionProps> = ({ bot, home, canEdit }) => {
  const [change, state] = useChangeOwnRuleMutation();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const disclaimer = useHomeField(bot.id, "disclaimer", home.fields.disclaimer, HOME.saving.failed);
  const crisis = useHomeField(bot.id, "crisisText", home.fields.crisisText, HOME.saving.failed);
  const addId = useId();
  const { pack, rules, version } = home.safety;
  const own = rules.filter(rule => !rule.fixed);

  const run = async (next: RuleChange): Promise<boolean> => {
    setError(null);
    try {
      await change({ id: bot.id, version, ...next }).unwrap();
      return true;
    } catch (failure) {
      setError(message(failure) ?? HOME.saving.failed);
      return false;
    }
  };

  return (
    <>
      <SectionHead title={HOME.sections.safety} subtitle={HOME.subtitles.safety} />

      {pack && (
        <SafetyCard
          title={fill(COPY.safety.title, { "Pack name": pack.name })}
          body={fill(COPY.safety.body, { industry: pack.industryLabel })}
          panels={{
            always: COPY.safety.always,
            never: COPY.safety.never,
            atRisk: COPY.safety.atRisk,
          }}
          always={pack.always}
          never={pack.never}
          atRisk={pack.atRisk}
          toggleLabel={COPY.safety.link}
        />
      )}

      <Group title={t.ownRules} hint={t.ownRulesHint} testId="safety-own-rules">
        {own.length > 0 && (
          <ul className="ally-home__rules">
            {own.map(rule => (
              <OwnRule
                key={`${rule.id}:${rule.text}`}
                rule={rule}
                canEdit={canEdit}
                busy={state.isLoading}
                onChange={run}
              />
            ))}
          </ul>
        )}
        {canEdit && own.length < 20 && (
          <form
            className="ally-home__rule-form"
            onSubmit={async event => {
              event.preventDefault();
              if (await run({ op: "add", text: draft })) setDraft("");
            }}
          >
            <label htmlFor={addId} className="ally-sr-only">
              {t.addRule}
            </label>
            <input
              id={addId}
              className="ally-input"
              placeholder={t.rulePlaceholder}
              value={draft}
              maxLength={200}
              onChange={event => setDraft(event.target.value)}
            />
            <Button type="submit" disabled={state.isLoading || !draft.trim()}>
              {t.addRule}
            </Button>
          </form>
        )}
        {error && (
          <p className="ally-error" role="alert">
            {error}
          </p>
        )}
      </Group>

      <Group testId="safety-messages">
        <TextField
          label={t.disclaimer}
          hint={t.disclaimerHint}
          field={disclaimer}
          disabled={!canEdit}
          multiline
          maxLength={300}
        />
        <TextField
          label={t.atRisk}
          hint={t.atRiskHint}
          field={crisis}
          disabled={!canEdit}
          multiline
          maxLength={1000}
        />
      </Group>
    </>
  );
};

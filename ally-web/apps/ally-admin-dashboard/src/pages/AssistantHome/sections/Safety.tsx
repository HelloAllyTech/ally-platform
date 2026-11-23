import React, { useId, useState } from "react";

import { RadioButton, RadioButtonGroup } from "@ally-ui-mono/ui-shared";
import { useChangeOwnRuleMutation, useChangeSafetyPackMutation } from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { SafetyCard } from "@components/v2";
import type { HomeSafety, RuleChange, SafetyRule } from "@types";

import { COPY, fill } from "../../Onboarding/copy";
import { HOME } from "../copy";
import { Group, LinesField, SectionHead, TextField } from "../fields";
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
          <Button variant={ButtonVariant.PRIMARY} type="submit" disabled={busy || !value.trim()}>
            {COPY.learned.save}
          </Button>
          <Button variant={ButtonVariant.TERTIARY} type="button" onClick={() => setEditing(false)}>
            {COPY.learned.cancel}
          </Button>
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

const MIN_REASON = 10;

/** "Safety rules changed by you on 18 Nov 2026", with the reason when it was less strict. */
export const packChangeLine = (change: HomeSafety["packChange"]): string | null => {
  if (!change) return null;
  const date = new Date(change.at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return change.lessStrict && change.reason
    ? fill(t.changedWhy, { date, reason: change.reason })
    : fill(t.changed, { date });
};

/**
 * "This isn't right for my business" (Q3-fast, C10): an owner switches to the pack that fits. An
 * equally strict or stricter pack changes at once; a less strict one asks why first, and the reason
 * is kept with the change. The setup chat still can't weaken a pack: only this owner action can.
 */
export const PackChooser: React.FC<{ botId: string; safety: HomeSafety }> = ({ botId, safety }) => {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changePack, state] = useChangeSafetyPackMutation();
  const groupId = useId();
  const reasonId = useId();
  const options = (safety.choices ?? []).filter(option => option.id !== safety.pack?.id);
  const picked = options.find(option => option.id === choice);
  const needsReason = Boolean(picked?.lessStrict);
  const tooShort = needsReason && reason.trim().length < MIN_REASON;

  if (!open) {
    return (
      <button
        type="button"
        className="ally-link"
        data-testid="pack-not-right"
        onClick={() => setOpen(true)}
      >
        {t.notRight}
      </button>
    );
  }
  return (
    <form
      className="ally-home__pack-chooser"
      data-testid="pack-chooser"
      onSubmit={async event => {
        event.preventDefault();
        if (!picked || tooShort) return;
        setError(null);
        try {
          await changePack({
            id: botId,
            pack: picked.id,
            ...(needsReason ? { reason: reason.trim() } : {}),
          }).unwrap();
          setOpen(false);
          setChoice(null);
          setReason("");
        } catch (failure) {
          setError(message(failure) ?? HOME.saving.failed);
        }
      }}
    >
      <RadioButtonGroup
        name="safety-pack"
        legendText={t.choose}
        orientation="vertical"
        valueSelected={choice ?? undefined}
        onChange={value => setChoice(String(value))}
      >
        {options.map(option => (
          <RadioButton
            key={option.id}
            id={`${groupId}-${option.id}`}
            value={option.id}
            labelText={`${option.name}${option.lessStrict ? ` · ${t.lessStrict}` : ""} — ${option.summary}`}
          />
        ))}
      </RadioButtonGroup>
      {needsReason && (
        <div>
          <label htmlFor={reasonId}>{t.reasonLabel}</label>
          <p className="ally-small">{t.reasonHint}</p>
          <textarea
            id={reasonId}
            className="ally-input"
            value={reason}
            maxLength={300}
            rows={3}
            onChange={event => setReason(event.target.value)}
          />
          {reason.length > 0 && tooShort && <p className="ally-small">{t.reasonShort}</p>}
        </div>
      )}
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
      <div className="ally-home__rule-actions">
        <Button
          variant={ButtonVariant.PRIMARY}
          type="submit"
          disabled={!picked || tooShort || state.isLoading}
        >
          {t.change}
        </Button>
        <Button variant={ButtonVariant.TERTIARY} type="button" onClick={() => setOpen(false)}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
};

/**
 * Rules the assistant always follows (chunk 20d): the safety pack (fixed), the owner's own rules on
 * top, the disclaimer before every chat, and what it says when someone may be at risk. A pack rule
 * has no Edit or Remove; the server refuses both anyway.
 */
export const SafetySection: React.FC<SectionProps> = ({ bot, home, canEdit, canManage }) => {
  const [change, state] = useChangeOwnRuleMutation();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const disclaimer = useHomeField(bot.id, "disclaimer", home.fields.disclaimer, HOME.saving.failed);
  const crisisField = useHomeField(
    bot.id,
    "crisisText",
    home.fields.crisisText,
    HOME.saving.failed,
  );
  // With nothing of the owner's, the box shows the reply people get today, to add to.
  const atRiskReply = home.safety.atRiskReply ?? "";
  const fromPack = !crisisField.value && Boolean(atRiskReply);
  const crisis = fromPack ? { ...crisisField, value: atRiskReply } : crisisField;
  const avoid = useHomeField(bot.id, "avoidTopics", home.fields.avoidTopics, HOME.saving.failed);
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
      <SectionHead
        title={HOME.sections.safety}
        subtitle={HOME.subtitles.safety}
        help={HOME.help.safety}
      />

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
      {packChangeLine(home.safety.packChange) && (
        <p className="ally-small" data-testid="pack-changed">
          {packChangeLine(home.safety.packChange)}
        </p>
      )}
      {canManage && (home.safety.choices?.length ?? 0) > 0 && (
        <PackChooser botId={bot.id} safety={home.safety} />
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
            <Button
              variant={ButtonVariant.TERTIARY}
              type="submit"
              disabled={state.isLoading || !draft.trim()}
            >
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

      <Group testId="safety-avoid">
        <LinesField
          label={HOME.avoid.label}
          hint={HOME.avoid.hint}
          addLabel={HOME.avoid.add}
          removeLabel={t.remove}
          field={avoid}
          max={10}
          maxLength={80}
          disabled={!canEdit}
        />
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
          hint={fromPack ? t.atRiskFromPack : t.atRiskHint}
          field={crisis}
          disabled={!canEdit}
          multiline
          maxLength={1000}
        />
      </Group>
    </>
  );
};

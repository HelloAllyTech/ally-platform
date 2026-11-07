import React, { useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";

import {
  AutoExpandableTextarea,
  CarbonToggle,
  NumberInput,
  SkeletonText,
} from "@ally-ui-mono/ui-shared";
import { useGetChatbotSettingsQuery, useUpdateChatbotSettingsMutation } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { WaBotSettings, WaOrgSettings } from "@types";

import { Card, errorMessage, fill, StatusPill, LoadError } from "./shared";
import { useReportUnsaved } from "./unsavedChanges";

const t = en.whatsappBot.orgSettings;
/** The same message reads the same here as in Defaults. */
const d = en.whatsappBot.bots.defaults;

type TextKey =
  | "helplineNumbers"
  | "disclaimerText"
  | "crisisEscalationText"
  | "declineText"
  | "fallbackText"
  | "unrecognisedNumberText"
  | "unsupportedMediaText"
  | "rateLimitText";

const MESSAGE_FIELDS: { key: TextKey; label: string }[] = [
  { key: "disclaimerText", label: d.disclaimerLabel },
  { key: "crisisEscalationText", label: d.crisisReplyLabel },
  { key: "declineText", label: d.declineLabel },
  { key: "unrecognisedNumberText", label: d.notListedLabel },
  { key: "fallbackText", label: d.fallbackLabel },
  { key: "unsupportedMediaText", label: d.mediaLabel },
  { key: "rateLimitText", label: d.tooManyLabel },
];

/**
 * One organisation's bot settings, always shown against the defaults it inherits.
 *
 * Every field starts as "Using default", with the default visible and greyed. "Customise" copies
 * the default in to be edited, and "Reset to default" removes the change. An organisation admin
 * can therefore see at a glance exactly what is different about their bot, and a platform-wide
 * change still reaches every field they never touched.
 *
 * The safety and limit fields mirror the backend's rules: the crisis classifier and consent can
 * only be switched ON here, and rate limits can only go lower.
 */
export const ChatbotSettingsTab: React.FC<{
  chatbotId: string;
  chatbotName: string;
  canEdit: boolean;
}> = ({ chatbotId, chatbotName, canEdit }) => {
  const { data, isLoading, isError, refetch } = useGetChatbotSettingsQuery(chatbotId);
  const [save, { isLoading: isSaving }] = useUpdateChatbotSettingsMutation();
  const [draft, setDraft] = useState<WaOrgSettings>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Follow the saved settings as they load or change, unless there are edits of our own: a refetch
  // must never wipe what someone is typing.
  const baseline = useRef<WaOrgSettings>({});
  useEffect(() => {
    if (!data) return;
    const previous = baseline.current;
    baseline.current = data.overrides;
    setDraft(current =>
      JSON.stringify(current) === JSON.stringify(previous) ? data.overrides : current,
    );
  }, [data]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(data?.overrides ?? {}),
    [draft, data],
  );
  useReportUnsaved("general", canEdit && dirty);

  if (isLoading) return <SkeletonText paragraph lineCount={10} />;
  if (isError || !data) {
    return <LoadError title={t.loadFailed} onRetry={() => void refetch()} />;
  }

  const defaults = data.defaults;
  const set = (patch: Partial<WaOrgSettings>) => setDraft(current => ({ ...current, ...patch }));
  const unset = (key: keyof WaOrgSettings) =>
    setDraft(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });

  const handleSave = async () => {
    try {
      await save({ id: chatbotId, settings: draft }).unwrap();
      toast.success(fill(t.saved, { org: chatbotName }));
    } catch (error) {
      toast.error(errorMessage(error, t.saveFailed));
    }
  };

  const text = (key: TextKey, label: string, help?: string) => (
    <InheritedText
      key={key}
      label={label}
      help={help}
      defaultValue={String(defaults[key] ?? "")}
      value={draft[key]}
      canEdit={canEdit}
      onCustomise={() => set({ [key]: String(defaults[key] ?? "") })}
      onChange={value => set({ [key]: value })}
      onReset={() => unset(key)}
    />
  );

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg text-typography-900 font-secondary">
          {fill(t.heading, { org: chatbotName })}
        </h2>
        <p className="text-sm text-typography-600">{t.intro}</p>
      </div>

      <Card title={t.groupBasics}>
        <div className="flex flex-col gap-1">
          <CarbonToggle
            id="wa-org-enabled"
            labelText={t.enabledLabel}
            size="sm"
            toggled={draft.enabled !== false && defaults.enabled}
            disabled={!canEdit || !defaults.enabled}
            // Off is the only change an organisation can make; on is simply "follow Ally".
            onToggle={(checked: boolean) => (checked ? unset("enabled") : set({ enabled: false }))}
          />
          <span className="text-xs text-typography-500">{t.enabledHelp}</span>
        </div>
        {text("helplineNumbers", d.helplineLabel, t.helplineHelp)}
      </Card>

      <Card title={t.groupMessages}>
        {MESSAGE_FIELDS.map(field => text(field.key, field.label))}
      </Card>

      <Card title={t.groupSafety}>
        <TightenToggle
          id="wa-org-classifier"
          label={d.crisisCheckLabel}
          help={t.crisisClassifierHelp}
          canEdit={canEdit}
          platformOn={defaults.crisisClassifierEnabled}
          value={draft.crisisClassifierEnabled}
          onChange={on =>
            on ? set({ crisisClassifierEnabled: true }) : unset("crisisClassifierEnabled")
          }
        />
        <TightenToggle
          id="wa-org-consent"
          label={t.consentLabel}
          help={t.consentHelp}
          canEdit={canEdit}
          platformOn={defaults.consentRequired}
          value={draft.consentRequired}
          onChange={on => (on ? set({ consentRequired: true }) : unset("consentRequired"))}
        />
        <RateLimits
          defaults={defaults}
          draft={draft}
          canEdit={canEdit}
          onChange={rateLimit => set({ rateLimit })}
        />
      </Card>

      <section className="flex flex-col gap-3">
        <button
          type="button"
          className="self-start text-sm text-primary-600 hover:underline"
          onClick={() => setShowAdvanced(open => !open)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? "▾" : "▸"} {t.groupAdvanced}
        </button>
        {showAdvanced && (
          <Card subtitle={t.advancedHint}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InheritedNumber
                label={d.floorLabel}
                canEdit={canEdit}
                defaultValue={defaults.retrieval.minSimilarity}
                value={draft.retrieval?.minSimilarity}
                step={0.01}
                min={0}
                max={1}
                onChange={value =>
                  set({ retrieval: withValue(draft.retrieval, "minSimilarity", value) })
                }
              />
              <InheritedNumber
                label={d.thresholdLabel}
                canEdit={canEdit}
                defaultValue={defaults.retrieval.declineSimilarity}
                value={draft.retrieval?.declineSimilarity}
                step={0.01}
                min={0}
                max={1}
                onChange={value =>
                  set({ retrieval: withValue(draft.retrieval, "declineSimilarity", value) })
                }
              />
              <InheritedNumber
                label={d.sourcesLabel}
                canEdit={canEdit}
                defaultValue={defaults.maxCitations}
                value={draft.maxCitations}
                min={0}
                max={10}
                onChange={value =>
                  value === undefined ? unset("maxCitations") : set({ maxCitations: value })
                }
              />
              <InheritedNumber
                label={d.idleLabel}
                canEdit={canEdit}
                defaultValue={defaults.conversationIdleMinutes}
                value={draft.conversationIdleMinutes}
                min={5}
                max={10080}
                onChange={value =>
                  value === undefined
                    ? unset("conversationIdleMinutes")
                    : set({ conversationIdleMinutes: value })
                }
              />
            </div>
          </Card>
        )}
      </section>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button
            variant={ButtonVariant.PRIMARY}
            onClick={() => void handleSave()}
            disabled={!dirty || isSaving}
          >
            {isSaving ? t.saving : t.save}
          </Button>
        </div>
      )}
    </div>
  );
};

/** Set or clear one key of a nested override, dropping the object when it ends up empty. */
function withValue<T extends object, K extends keyof T>(
  current: T | undefined,
  key: K,
  value: T[K] | undefined,
): T | undefined {
  const next = { ...(current ?? {}) } as T;
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? next : undefined;
}

/** The field's state as a pill: whether this organisation changed it. */
const StateLabel: React.FC<{ customised: boolean }> = ({ customised }) =>
  customised ? (
    <StatusPill tone="success">{t.customised}</StatusPill>
  ) : (
    <StatusPill tone="neutral">{t.usingDefault}</StatusPill>
  );

/**
 * A text field that inherits. Untouched, it shows the default greyed with "Customise"; once
 * customised, the text is editable with "Reset to default".
 */
const InheritedText: React.FC<{
  label: string;
  help?: string;
  defaultValue: string;
  value: string | undefined;
  canEdit: boolean;
  onCustomise: () => void;
  onChange: (value: string) => void;
  onReset: () => void;
}> = ({ label, help, defaultValue, value, canEdit, onCustomise, onChange, onReset }) => {
  const customised = value !== undefined;
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className="text-sm text-typography-800">{label}</span>
          <StateLabel customised={customised} />
        </span>
        {canEdit && (
          <button
            type="button"
            className="text-sm text-primary-600 hover:underline shrink-0"
            onClick={customised ? onReset : onCustomise}
          >
            {customised ? t.reset : t.customise}
          </button>
        )}
      </div>
      {customised && canEdit ? (
        <AutoExpandableTextarea value={value} onChange={onChange} minHeight={60} />
      ) : (
        <p className="text-sm text-typography-500 whitespace-pre-wrap border border-dashed border-border-light rounded px-3 py-2">
          {(customised ? value : defaultValue) || "—"}
        </p>
      )}
      {help && <span className="text-xs text-typography-500">{help}</span>}
    </div>
  );
};

/**
 * A safety switch an organisation can only turn ON. When Ally already has it on for everyone it
 * shows as on and locked, since there is nothing for the organisation to decide.
 */
const TightenToggle: React.FC<{
  id: string;
  label: string;
  help: string;
  platformOn: boolean;
  value: boolean | undefined;
  canEdit: boolean;
  onChange: (on: boolean) => void;
}> = ({ id, label, help, platformOn, value, canEdit, onChange }) => (
  <div className="flex flex-col gap-1">
    <CarbonToggle
      id={id}
      labelText={label}
      size="sm"
      toggled={platformOn || value === true}
      disabled={!canEdit || platformOn}
      onToggle={onChange}
    />
    <span className="text-xs text-typography-500">{help}</span>
  </div>
);

const RateLimits: React.FC<{
  defaults: WaBotSettings;
  draft: WaOrgSettings;
  canEdit: boolean;
  onChange: (rateLimit: WaOrgSettings["rateLimit"]) => void;
}> = ({ defaults, draft, canEdit, onChange }) => (
  <div className="flex flex-col gap-2">
    <span className="text-sm text-typography-800">{t.rateLimitLabel}</span>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {(["perMinute", "perHour", "perDay"] as const).map(key => (
        <InheritedNumber
          key={key}
          label={d[key]}
          defaultValue={defaults.rateLimit[key]}
          value={draft.rateLimit?.[key]}
          min={1}
          max={defaults.rateLimit[key]}
          canEdit={canEdit}
          onChange={value => onChange(withValue(draft.rateLimit, key, value))}
        />
      ))}
    </div>
    <span className="text-xs text-typography-500">{t.rateLimitHelp}</span>
  </div>
);

/**
 * A number that inherits: empty means "use the default", which is shown as the placeholder.
 */
const InheritedNumber: React.FC<{
  label: string;
  defaultValue: number;
  value: number | undefined;
  min?: number;
  max?: number;
  step?: number;
  canEdit: boolean;
  onChange: (value: number | undefined) => void;
}> = ({ label, defaultValue, value, min, max, step, canEdit, onChange }) => (
  <div className="flex flex-col gap-1">
    <NumberInput
      id={`wa-org-${label.replace(/\s+/g, "-").toLowerCase()}`}
      label={label}
      value={value ?? ""}
      placeholder={`${t.defaultLabel}: ${defaultValue}`}
      helperText={value === undefined ? `${t.usingDefault} (${defaultValue})` : t.customised}
      min={min}
      max={max}
      step={step}
      hideSteppers
      allowEmpty
      disabled={!canEdit}
      onChange={(_event: unknown, state: { value: number | string } | undefined) => {
        const raw = state?.value;
        if (raw === "" || raw === undefined) return onChange(undefined);
        const next = Number(raw);
        if (!Number.isNaN(next)) onChange(next);
      }}
    />
  </div>
);

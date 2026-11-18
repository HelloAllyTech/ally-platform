import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import {
  CarbonToggle,
  InlineNotification,
  NumberInput,
  SkeletonText,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import { useGetWaSettingsQuery, useUpdateWaSettingsMutation } from "@api";
import { Button } from "@components";
import { TooltipHint } from "@components/app-tooltip";
import { ButtonVariant } from "@components/types";
import { en, TooltipLocation } from "@constants";
import { WaBotSettings } from "@types";

import { Card, LoadError } from "./shared";

const t = en.whatsappBot.bots.defaults;

/**
 * The defaults every agent starts from, as a few small groups that each answer one question —
 * is it on, what does it say in a crisis, what does it say when it can't help, how much can one
 * person send — with the retrieval tuning folded away under Advanced.
 *
 * Everything here is read per message by ally-be, so a save takes effect on the next inbound
 * message. Two deliberate omissions: provider credentials (they live in the environment), and each
 * agent's instructions and model (they belong to the agent).
 */
export const BotSettingsTab: React.FC = () => {
  const { data, isLoading, isError, refetch } = useGetWaSettingsQuery();
  const [updateSettings, { isLoading: isSaving }] = useUpdateWaSettingsMutation();
  const [draft, setDraft] = useState<WaBotSettings | null>(null);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const dirty = useMemo(
    () => Boolean(data && draft) && JSON.stringify(data) !== JSON.stringify(draft),
    [data, draft],
  );

  const set = <K extends keyof WaBotSettings>(key: K, value: WaBotSettings[K]) =>
    setDraft(current => (current ? { ...current, [key]: value } : current));
  const setRetrieval = <K extends keyof WaBotSettings["retrieval"]>(
    key: K,
    value: WaBotSettings["retrieval"][K],
  ) =>
    setDraft(current =>
      current ? { ...current, retrieval: { ...current.retrieval, [key]: value } } : current,
    );
  const setRateLimit = <K extends keyof WaBotSettings["rateLimit"]>(
    key: K,
    value: WaBotSettings["rateLimit"][K],
  ) =>
    setDraft(current =>
      current ? { ...current, rateLimit: { ...current.rateLimit, [key]: value } } : current,
    );

  const handleSave = async () => {
    if (!draft) return;
    try {
      await updateSettings(draft).unwrap();
      toast.success(t.saved);
    } catch {
      toast.error(t.saveFailed);
    }
  };

  if (isError) return <LoadError title={t.loadFailed} onRetry={() => void refetch()} />;
  if (isLoading || !draft) return <SkeletonText paragraph lineCount={10} />;

  return (
    <div className="flex flex-col gap-6 max-w-3xl pb-24">
      <Card title={t.switchesTitle} subtitle={t.switchesIntro}>
        <Toggle
          id="wa-enabled"
          label={t.enabledLabel}
          help={t.enabledHelp}
          value={draft.enabled}
          onChange={value => set("enabled", value)}
        />
        <div className="border-t border-border-light" />
        <Toggle
          id="wa-crisis-classifier"
          label={t.crisisCheckLabel}
          help={t.crisisCheckHelp}
          tooltipLocation={TooltipLocation.WA_CRISIS_CLASSIFIER}
          value={draft.crisisClassifierEnabled}
          onChange={value => set("crisisClassifierEnabled", value)}
        />
        {!draft.crisisClassifierEnabled && (
          <InlineNotification
            kind="warning"
            title={t.crisisClassifierOffWarning}
            lowContrast
            hideCloseButton
          />
        )}
        <div className="border-t border-border-light" />
        <Toggle
          id="wa-agent-runtime"
          label={t.agentRuntimeLabel}
          help={t.agentRuntimeHelp}
          value={draft.agentRuntimeAllowed}
          onChange={value => set("agentRuntimeAllowed", value)}
        />
      </Card>

      <Card title={t.safetyTitle} subtitle={t.safetyIntro}>
        <Field label={t.helplineLabel} help={t.helplineHelp}>
          <TextInput
            id="wa-helpline"
            labelText=""
            hideLabel
            value={draft.helplineNumbers}
            onChange={event => set("helplineNumbers", event.target.value)}
          />
        </Field>
        <Message
          label={t.crisisReplyLabel}
          help={t.crisisReplyHelp}
          value={draft.crisisEscalationText}
          onChange={value => set("crisisEscalationText", value)}
        />
        <Message
          label={t.disclaimerLabel}
          help={t.disclaimerHelp}
          value={draft.disclaimerText}
          onChange={value => set("disclaimerText", value)}
        />
      </Card>

      <Card title={t.cantHelpTitle} subtitle={t.cantHelpIntro}>
        <Message
          label={t.declineLabel}
          value={draft.declineText}
          onChange={value => set("declineText", value)}
        />
        <Message
          label={t.notListedLabel}
          help={t.notListedHelp}
          value={draft.unrecognisedNumberText}
          onChange={value => set("unrecognisedNumberText", value)}
        />
        <Message
          label={t.fallbackLabel}
          value={draft.fallbackText}
          onChange={value => set("fallbackText", value)}
        />
        <Message
          label={t.mediaLabel}
          value={draft.unsupportedMediaText}
          onChange={value => set("unsupportedMediaText", value)}
        />
        <Message
          label={t.tooManyLabel}
          value={draft.rateLimitText}
          onChange={value => set("rateLimitText", value)}
        />
      </Card>

      <Card title={t.limitsTitle} subtitle={t.limitsIntro}>
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(["perMinute", "perHour", "perDay"] as const).map(key => (
              <Num
                key={key}
                label={t[key]}
                value={draft.rateLimit[key]}
                min={0}
                onChange={value => setRateLimit(key, value)}
              />
            ))}
          </div>
          <span className="text-xs text-typography-500">{t.perPersonHelp}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Num
            label={t.idleLabel}
            help={t.idleHelp}
            tooltipLocation={TooltipLocation.WA_CONVERSATION_IDLE}
            value={draft.conversationIdleMinutes}
            min={5}
            onChange={value => set("conversationIdleMinutes", value)}
          />
          <Num
            label={t.retentionLabel}
            help={t.retentionHelp}
            tooltipLocation={TooltipLocation.WA_RETENTION_DAYS}
            value={draft.retentionDays}
            min={0}
            onChange={value => set("retentionDays", value)}
          />
        </div>
        {/* Indefinite retention of people's questions against their phone numbers is a decision,
            and it should look like one on the screen where it is made. */}
        {draft.retentionDays === 0 && (
          <InlineNotification
            kind="warning"
            title={t.retentionOffWarning}
            lowContrast
            hideCloseButton
          />
        )}
      </Card>

      <details className="group border border-border-light rounded-md">
        <summary className="cursor-pointer list-none p-5 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-base text-typography-900 font-secondary">{t.advancedTitle}</span>
            <span className="text-sm text-typography-600">{t.advancedIntro}</span>
          </div>
          <span
            className="text-typography-500 transition-transform group-open:rotate-180"
            aria-hidden
          >
            ▾
          </span>
        </summary>
        <div className="flex flex-col gap-4 px-5 pb-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Num
              label={t.floorLabel}
              tooltipLocation={TooltipLocation.WA_MIN_SIMILARITY}
              value={draft.retrieval.minSimilarity}
              min={0}
              max={1}
              step={0.01}
              onChange={value => setRetrieval("minSimilarity", value)}
            />
            <Num
              label={t.thresholdLabel}
              help={t.thresholdHelp}
              tooltipLocation={TooltipLocation.WA_DECLINE_SIMILARITY}
              value={draft.retrieval.declineSimilarity}
              min={0}
              max={1}
              step={0.01}
              onChange={value => setRetrieval("declineSimilarity", value)}
            />
          </div>
          {/* Warned about rather than clamped: clamping would hide a misconfiguration. */}
          {draft.retrieval.minSimilarity > draft.retrieval.declineSimilarity && (
            <InlineNotification
              kind="warning"
              title={t.thresholdWarning}
              lowContrast
              hideCloseButton
            />
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Num
              label={t.topKLabel}
              value={draft.retrieval.topK}
              min={1}
              max={50}
              onChange={value => setRetrieval("topK", value)}
            />
            <Num
              label={t.maxPassagesLabel}
              value={draft.retrieval.maxPassages}
              min={1}
              max={20}
              onChange={value => setRetrieval("maxPassages", value)}
            />
          </div>
          <Toggle
            id="wa-translate"
            label={t.translateLabel}
            help={t.translateHelp}
            value={draft.retrieval.translateQuery}
            onChange={value => setRetrieval("translateQuery", value)}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Num
              label={t.answerLengthLabel}
              value={draft.maxAnswerChars}
              min={100}
              onChange={value => set("maxAnswerChars", value)}
            />
            <Num
              label={t.replyLengthLabel}
              help={t.replyLengthHelp}
              value={draft.maxReplyChars}
              min={100}
              max={4096}
              onChange={value => set("maxReplyChars", value)}
            />
            <Num
              label={t.sourcesLabel}
              value={draft.maxCitations}
              min={0}
              max={10}
              onChange={value => set("maxCitations", value)}
            />
          </div>
        </div>
      </details>

      <p className="text-sm text-typography-600">{t.agentNote}</p>

      {/* Appears only when something changed, and stays in view however far down the edit was. */}
      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border-light bg-white">
          <div className="max-w-3xl mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-typography-900">{t.unsaved}</span>
            <div className="flex gap-2">
              <Button variant={ButtonVariant.SECONDARY} onClick={() => setDraft(data ?? null)}>
                {t.discard}
              </Button>
              <Button
                variant={ButtonVariant.PRIMARY}
                onClick={() => void handleSave()}
                disabled={isSaving}
              >
                {t.save}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Field: React.FC<{
  label: string;
  help?: string;
  tooltipLocation?: string;
  children: React.ReactNode;
}> = ({ label, help, tooltipLocation, children }) => (
  <div className="flex flex-col gap-1">
    <label className="text-sm text-typography-900">{label}</label>
    {children}
    {(help || tooltipLocation) && (
      <span className="flex items-center gap-1 text-xs text-typography-500">
        {help}
        <TooltipHint location={tooltipLocation} />
      </span>
    )}
  </div>
);

/** Enough rows to show the whole message without scrolling, up to a sensible cap. */
const rowsFor = (text: string) =>
  Math.min(
    8,
    Math.max(
      2,
      text.split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 90)), 0),
    ),
  );

const Message: React.FC<{
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, help, value, onChange }) => (
  <Field label={label} help={help}>
    <TextArea
      id={`wa-${label.replace(/\W+/g, "-").toLowerCase()}`}
      labelText=""
      hideLabel
      rows={rowsFor(value)}
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  </Field>
);

const Toggle: React.FC<{
  id: string;
  label: string;
  help: string;
  value: boolean;
  onChange: (value: boolean) => void;
  tooltipLocation?: string;
}> = ({ id, label, help, value, onChange, tooltipLocation }) => (
  <div className="flex items-start justify-between gap-6">
    <div className="flex flex-col gap-1">
      <span className="text-sm text-typography-900">{label}</span>
      <span className="flex items-center gap-1 text-xs text-typography-500">
        {help}
        <TooltipHint location={tooltipLocation} />
      </span>
    </div>
    <CarbonToggle
      id={id}
      labelText=""
      aria-label={label}
      labelA={t.off}
      labelB={t.on}
      size="sm"
      toggled={value}
      onToggle={(checked: boolean) => onChange(checked)}
    />
  </div>
);

const Num: React.FC<{
  label: string;
  help?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  /** Data-driven tooltip slug; renders nothing until a superadmin enables it in Manage Tooltips. */
  tooltipLocation?: string;
}> = ({ label, help, value, min, max, step, onChange, tooltipLocation }) => (
  <Field label={label} help={help} tooltipLocation={tooltipLocation}>
    <NumberInput
      id={`wa-${label.replace(/\W+/g, "-").toLowerCase()}`}
      label=""
      hideLabel
      value={value}
      min={min}
      max={max}
      step={step}
      hideSteppers
      onChange={(_event: unknown, state: { value: number | string } | undefined) => {
        const next = Number(state?.value);
        if (!Number.isNaN(next)) onChange(next);
      }}
    />
  </Field>
);

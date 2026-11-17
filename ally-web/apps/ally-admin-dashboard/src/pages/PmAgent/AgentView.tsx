import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  CarbonToggle,
  ContentSwitcher,
  NumberInput,
  SkeletonText,
  Switch,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useDeletePmAgentMemoryMutation,
  useGetPmAgentHealthQuery,
  useGetPmAgentHistoryQuery,
  useGetPmAgentMemoryQuery,
  useGetPmAgentFeedStateQuery,
  useUpdatePmAgentMemoryMutation,
} from "@api";
import type { PmAgentStateResponse, PmLesson, PmSettingsPatch } from "@types";

import { copy } from "./copy";
import { absoluteTime, formatPercent, formatUsd, relativeTime } from "./format";
import { usePmAgentControls } from "./usePmAgentControls";
import { InfoTip } from "../../components/ally-guide/InfoTip";

const a = copy.agent;
type Section = "settings" | "memory" | "history" | "health";
const SECTIONS: Section[] = ["settings", "memory", "history", "health"];

const Labelled: React.FC<{ label: string; tip?: string; children: React.ReactNode }> = ({
  label,
  tip,
  children,
}) => (
  <div className="flex items-center gap-2 text-sm text-typography-800">
    <span>{label}</span>
    {tip && <InfoTip label={tip} ariaLabel={`About ${label.toLowerCase()}`} />}
    {children}
  </div>
);

/** Validates a settings form; returns the patch or the per-field errors. Pure. */
export const validateSettings = (input: {
  budget: string;
  cap: string;
  hour: string;
  mandate: string;
}): { patch?: PmSettingsPatch; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};
  const budget = Number(input.budget);
  const cap = Number(input.cap);
  const hour = Number(input.hour);
  if (input.budget.trim() === "" || Number.isNaN(budget) || budget < 0)
    errors.budget = a.invalidBudget;
  if (!Number.isInteger(cap) || cap < 1 || cap > 10) errors.cap = a.invalidCap;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) errors.hour = a.invalidHour;
  if (!input.mandate.trim()) errors.mandate = a.mandateRequired;
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    patch: {
      monthlyBudgetUsd: budget,
      queueCap: cap,
      runHourIst: hour,
      mandate: input.mandate.trim(),
    },
  };
};

const SettingsSection: React.FC<{ state: PmAgentStateResponse }> = ({ state }) => {
  const { settings, budget } = state;
  const controls = usePmAgentControls();
  const [budgetText, setBudgetText] = useState(String(settings.monthlyBudgetUsd));
  const [cap, setCap] = useState(String(settings.queueCap));
  const [hour, setHour] = useState(String(settings.runHourIst));
  const [mandate, setMandate] = useState(settings.mandate);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pick up server changes (another tab, a socket push) unless the user is mid-edit.
  useEffect(() => {
    setBudgetText(String(settings.monthlyBudgetUsd));
    setCap(String(settings.queueCap));
    setHour(String(settings.runHourIst));
    setMandate(settings.mandate);
  }, [settings.monthlyBudgetUsd, settings.queueCap, settings.runHourIst, settings.mandate]);

  const pct =
    budget.monthlyBudgetUsd > 0
      ? Math.min(100, (budget.spentUsd / budget.monthlyBudgetUsd) * 100)
      : 0;

  const submit = async () => {
    const result = validateSettings({ budget: budgetText, cap, hour, mandate });
    setErrors(result.errors);
    if (!result.patch) return;
    await controls.save(result.patch, a.saved);
  };

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <Labelled label={a.budget} tip={a.budgetTip}>
          {null}
        </Labelled>
        <div
          role="meter"
          aria-label={a.budgetMeter(
            formatUsd(budget.spentUsd, false),
            formatUsd(budget.monthlyBudgetUsd, false),
          )}
          aria-valuemin={0}
          aria-valuemax={budget.monthlyBudgetUsd}
          aria-valuenow={budget.spentUsd}
          className="mt-2 h-3 w-full overflow-hidden rounded bg-neutral-100"
        >
          <div
            className={`h-full ${pct >= 90 ? "bg-red-600" : "bg-primary-600"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-sm text-typography-700">
          {a.budgetMeter(
            formatUsd(budget.spentUsd, false),
            formatUsd(budget.monthlyBudgetUsd, false),
          )}
          {budget.reservedUsd > 0 && ` · ${a.budgetReserved(formatUsd(budget.reservedUsd, false))}`}
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <NumberInput
          id="pm-budget"
          label={a.budget}
          min={0}
          step={10}
          allowEmpty
          value={budgetText}
          onChange={(_e: unknown, { value }: { value: number | string }) =>
            setBudgetText(String(value))
          }
          invalid={Boolean(errors.budget)}
          invalidText={errors.budget ?? ""}
        />
        <div>
          <NumberInput
            id="pm-cap"
            label={a.queueCap}
            min={1}
            max={10}
            allowEmpty
            value={cap}
            onChange={(_e: unknown, { value }: { value: number | string }) => setCap(String(value))}
            invalid={Boolean(errors.cap)}
            invalidText={errors.cap ?? ""}
          />
          <InfoTip label={a.queueCapTip} ariaLabel="About the queue cap" />
        </div>
        <div>
          <NumberInput
            id="pm-hour"
            label={a.runHour}
            min={0}
            max={23}
            allowEmpty
            value={hour}
            onChange={(_e: unknown, { value }: { value: number | string }) =>
              setHour(String(value))
            }
            invalid={Boolean(errors.hour)}
            invalidText={errors.hour ?? ""}
          />
          <InfoTip label={a.runHourTip} ariaLabel="About the run hour" />
        </div>
      </div>

      <div>
        <TextArea
          id="pm-mandate"
          labelText={a.mandate}
          rows={5}
          value={mandate}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMandate(e.target.value)}
          invalid={Boolean(errors.mandate)}
          invalidText={errors.mandate ?? ""}
        />
        <InfoTip label={a.mandateTip} ariaLabel="About the mandate" />
      </div>

      <div>
        <Button size="md" disabled={controls.saving} onClick={submit}>
          {a.save}
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-t border-neutral-500 pt-4">
        <div className="flex items-center gap-2">
          <CarbonToggle
            id="pm-enabled"
            labelText={a.enabled}
            labelA="Off"
            labelB="On"
            toggled={settings.enabled}
            onToggle={(v: boolean) => controls.save({ enabled: v })}
          />
          <InfoTip label={a.enabledTip} ariaLabel="About the kill switch" />
        </div>
        <div className="flex items-center gap-2">
          <CarbonToggle
            id="pm-pause-auto-build"
            labelText={a.pauseAutoBuild}
            labelA="Off"
            labelB="On"
            toggled={settings.pauseAutoBuild}
            onToggle={(v: boolean) => controls.save({ pauseAutoBuild: v })}
          />
          <InfoTip label={a.pauseAutoBuildTip} ariaLabel="About pausing auto-build" />
        </div>
        <div className="flex items-center gap-2">
          <CarbonToggle
            id="pm-slack"
            labelText={a.slackNotify}
            labelA="Off"
            labelB="On"
            toggled={settings.slackNotify}
            onToggle={(v: boolean) => controls.save({ slackNotify: v })}
          />
          <InfoTip label={a.slackNotifyTip} ariaLabel="About Slack notifications" />
        </div>
      </div>
    </div>
  );
};

const FactRow: React.FC<{ id: string; value: string; active?: boolean }> = ({
  id,
  value,
  active,
}) => {
  const [update] = useUpdatePmAgentMemoryMutation();
  const [remove] = useDeletePmAgentMemoryMutation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!text.trim()) {
      setError(a.memoryEmptyValue);
      return;
    }
    try {
      await update({ id, value: text.trim() }).unwrap();
      toast.success(a.memorySaved);
      setEditing(false);
      setError(null);
    } catch {
      toast.error(a.memoryFailed);
    }
  };
  const del = async () => {
    try {
      await remove(id).unwrap();
      toast.success(a.memoryRemoved);
    } catch {
      toast.error(a.memoryFailed);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded border border-neutral-500 p-3">
      {editing ? (
        <>
          <TextInput
            id={`fact-${id}`}
            labelText="Fact"
            hideLabel
            value={text}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setText(e.target.value);
              setError(null);
            }}
            invalid={Boolean(error)}
            invalidText={error ?? ""}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>
              {a.memorySave}
            </Button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setEditing(false);
                setText(value);
                setError(null);
              }}
            >
              {a.memoryCancel}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-typography-900">
            {value}
            {active === false && (
              <span className="ml-2 text-xs text-typography-600">({a.memoryInactive})</span>
            )}
          </p>
          <span className="flex gap-1">
            <Button size="sm" kind="tertiary" onClick={() => setEditing(true)}>
              {a.memoryEdit}
            </Button>
            <Button size="sm" kind="ghost" onClick={del}>
              {a.memoryRemove}
            </Button>
          </span>
        </div>
      )}
    </li>
  );
};

const lessonText = (l: PmLesson): string => l.text ?? l.lesson ?? l.summary ?? "";

const MemorySection: React.FC = () => {
  const { data, isLoading } = useGetPmAgentMemoryQuery();
  if (isLoading) return <SkeletonText paragraph lineCount={3} />;
  const facts = data?.facts ?? [];
  const lessons = (data?.lessons ?? []).filter(l => lessonText(l));
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section aria-label={a.sections.memory} className="flex flex-col gap-2">
        <p className="text-sm text-typography-700">{a.memoryIntro}</p>
        {facts.length === 0 ? (
          <p className="text-sm text-typography-600">{a.memoryEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {facts.map(f => (
              <FactRow key={f.id} id={f.id} value={f.value} active={f.active} />
            ))}
          </ul>
        )}
      </section>
      <section aria-label={a.lessonsTitle} className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-typography-900">{a.lessonsTitle}</h3>
        {lessons.length === 0 ? (
          <p className="text-sm text-typography-600">{a.lessonsEmpty}</p>
        ) : (
          <ul className="list-disc pl-5 text-sm text-typography-800">
            {lessons.map((l, i) => (
              <li key={l.id ?? i}>{lessonText(l)}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

const HistorySection: React.FC = () => {
  const { data, isLoading } = useGetPmAgentHistoryQuery();
  if (isLoading) return <SkeletonText paragraph lineCount={3} />;
  const cards = data?.cards ?? [];
  return (
    <section aria-label={a.sections.history} className="flex max-w-2xl flex-col gap-2">
      <p className="text-sm text-typography-700">{a.historyIntro}</p>
      {cards.length === 0 ? (
        <p className="text-sm text-typography-600">{a.historyEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map(c => (
            <li
              key={c.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-neutral-500 p-3"
            >
              <span className="text-sm text-typography-900">{c.title}</span>
              <span
                className="text-xs text-typography-600"
                title={absoluteTime(c.decidedAt ?? c.createdAt)}
              >
                {a.historyOutcome[c.status] ?? c.status} ·{" "}
                {relativeTime(c.decidedAt ?? c.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const HealthSection: React.FC = () => {
  const { data, isLoading, isError } = useGetPmAgentHealthQuery();
  if (isLoading) return <SkeletonText paragraph lineCount={3} />;
  if (isError || !data) return <p className="text-sm text-red-700">{a.healthLoadError}</p>;
  const rows: { key: keyof typeof a.metrics; value: string }[] = [
    { key: "acceptRate7d", value: formatPercent(data.acceptRate7d) },
    { key: "acceptRate30d", value: formatPercent(data.acceptRate30d) },
    { key: "shippedRate", value: formatPercent(data.shippedRate) },
    { key: "costPerAcceptedCardUsd", value: formatUsd(data.costPerAcceptedCardUsd) },
    { key: "repeatedRejectionRate", value: formatPercent(data.repeatedRejectionRate) },
  ];
  const lanes = Object.entries(data.spendByLane ?? {});
  return (
    <section aria-label={a.healthTitle} className="flex max-w-2xl flex-col gap-4">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map(r => (
          <div key={r.key} className="rounded border border-neutral-500 p-3">
            <dt className="flex items-center gap-1 text-sm text-typography-700">
              {a.metrics[r.key]}
              <InfoTip
                label={a.metricTips[r.key]}
                ariaLabel={`About ${a.metrics[r.key].toLowerCase()}`}
              />
            </dt>
            <dd className="text-xl font-semibold text-typography-900">{r.value}</dd>
          </div>
        ))}
      </dl>
      {lanes.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-typography-800">{a.spendByLane}</h3>
          <ul className="text-sm text-typography-800">
            {lanes.map(([lane, usd]) => (
              <li key={lane} className="flex justify-between border-b border-neutral-100 py-1">
                <span>{lane.replace(/_/g, " ")}</span>
                <span>{formatUsd(usd)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export const AgentView: React.FC<{ initialSection?: Section }> = ({
  initialSection = "settings",
}) => {
  const [section, setSection] = useState<Section>(initialSection);
  const { data: state, isLoading, isError } = useGetPmAgentFeedStateQuery();

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xl">
        <ContentSwitcher
          size="md"
          selectedIndex={SECTIONS.indexOf(section)}
          onChange={(e: { name?: string | number }) => setSection(String(e.name) as Section)}
        >
          {SECTIONS.map(s => (
            <Switch key={s} name={s} text={a.sections[s]} />
          ))}
        </ContentSwitcher>
      </div>
      {section === "settings" &&
        (isLoading ? (
          <SkeletonText paragraph lineCount={4} />
        ) : isError || !state ? (
          <p className="text-sm text-red-700">{a.loadError}</p>
        ) : (
          <SettingsSection state={state} />
        ))}
      {section === "memory" && <MemorySection />}
      {section === "history" && <HistorySection />}
      {section === "health" && <HealthSection />}
    </div>
  );
};

import React, { useState } from "react";

import { Button, NumberInput, TextArea } from "@ally-ui-mono/ui-shared";
import type { PmAgentStateResponse, PmSettingsPatch } from "@types";

import { copy } from "./copy";
import { nextRunLabel, relativeTime } from "./format";

export type StatusKind =
  | "running"
  | "queue_full"
  | "disabled"
  | "budget_exhausted"
  | "run_failed"
  | "none";

/** The single most important status to show above the queue. Pure, so it is easy to test. */
export const deriveStatusKind = (state: PmAgentStateResponse | undefined): StatusKind => {
  if (!state) return "none";
  if (state.agentState === "disabled") return "disabled";
  if (state.agentState === "budget_exhausted") return "budget_exhausted";
  if (state.agentState === "running") return "running";
  if (state.lastRun?.status === "failed") return "run_failed";
  if (state.agentState === "queue_full") return "queue_full";
  return "none";
};

/** First run: never run, never turned on, nothing asked for. */
export const isFirstRun = (state: PmAgentStateResponse | undefined, cardCount: number): boolean =>
  Boolean(state) && !state!.settings.enabled && !state!.lastRun && cardCount === 0;

const Box: React.FC<{
  tone?: "info" | "warn" | "error";
  role?: "status" | "alert";
  children: React.ReactNode;
}> = ({ tone = "info", role = "status", children }) => {
  const cls =
    tone === "error"
      ? "border-red-600 bg-red-50"
      : tone === "warn"
        ? "border-amber-600 bg-amber-50"
        : "border-neutral-500 bg-neutral-100";
  return (
    <div
      role={role}
      className={`flex flex-wrap items-center justify-between gap-3 rounded border p-3 ${cls}`}
    >
      {children}
    </div>
  );
};

export interface StatusBannerProps {
  state: PmAgentStateResponse | undefined;
  disabled?: boolean;
  onRunNow: () => void;
  onTurnOn: () => void;
  onOpenSettings: () => void;
}

export const StatusBanner: React.FC<StatusBannerProps> = ({
  state,
  disabled,
  onRunNow,
  onTurnOn,
  onOpenSettings,
}) => {
  const kind = deriveStatusKind(state);
  if (!state || kind === "none") return null;
  const reason = state.stopReason ? (
    <span className="text-sm text-typography-700"> {state.stopReason}</span>
  ) : null;
  switch (kind) {
    case "running":
      return (
        <Box>
          <p className="text-sm text-typography-900">
            <span aria-hidden="true">⟳ </span>
            {copy.stateRunning}
          </p>
        </Box>
      );
    case "queue_full":
      return (
        <Box>
          <p className="text-sm text-typography-900">{copy.stateQueueFull(state.queue.open)}</p>
        </Box>
      );
    case "disabled":
      return (
        <Box tone="warn">
          <p className="text-sm text-typography-900">
            <span className="font-semibold">{copy.stateDisabled}</span> {copy.stateDisabledBody}
            {reason}
          </p>
          <Button size="sm" disabled={disabled} onClick={onTurnOn}>
            {copy.turnOn}
          </Button>
        </Box>
      );
    case "budget_exhausted":
      return (
        <Box tone="warn">
          <p className="text-sm text-typography-900">
            <span className="font-semibold">{copy.stateBudget}</span> {copy.stateBudgetBody}
            {reason}
          </p>
          <Button size="sm" kind="tertiary" onClick={onOpenSettings}>
            {copy.openSettings}
          </Button>
        </Box>
      );
    case "run_failed":
      return (
        <Box tone="error" role="alert">
          <p className="text-sm text-typography-900">
            <span className="font-semibold">{copy.runFailedTitle}.</span> {copy.runFailedBody}
            {state.lastRun?.error ? (
              <span className="text-typography-700"> {state.lastRun.error}</span>
            ) : null}
          </p>
          <Button size="sm" disabled={disabled} onClick={onRunNow}>
            {copy.retry}
          </Button>
        </Box>
      );
    default:
      return null;
  }
};

/** What to say when there are no cards left to review. */
export const EmptyPanel: React.FC<{
  state: PmAgentStateResponse | undefined;
  disabled?: boolean;
  running?: boolean;
  onRunNow: () => void;
}> = ({ state, disabled, running, onRunNow }) => {
  if (!state) return null;
  const kind = deriveStatusKind(state);
  const next = nextRunLabel(state.nextRunAt);
  const last = state.lastRun;
  const nothingMetBar =
    kind === "none" &&
    last?.status !== "failed" &&
    last?.cardsCreated === 0 &&
    state.queue.open === 0;
  let message: string;
  if (kind === "running") message = copy.agentLooking;
  else if (kind === "queue_full") message = copy.stateQueueFull(state.queue.open);
  else if (nothingMetBar)
    message = copy.stateNothingBar(last?.finishedAt ? ` ${relativeTime(last.finishedAt)}` : "");
  else if (kind === "none") message = next ? copy.stateCaughtUp(next) : copy.stateCaughtUpNoRun;
  else return null; // The banner already says why.
  return (
    <div className="flex flex-col items-start gap-3 rounded border border-neutral-500 p-6">
      <p className="text-base text-typography-900" role="status">
        {message}
      </p>
      {kind === "none" && (
        <Button kind="tertiary" size="md" disabled={disabled || running} onClick={onRunNow}>
          {copy.runNow}
        </Button>
      )}
      {kind === "running" && (
        <div aria-hidden="true" className="h-16 w-full animate-pulse rounded bg-neutral-100" />
      )}
    </div>
  );
};

export interface SetupPanelProps {
  state: PmAgentStateResponse;
  saving?: boolean;
  onSave: (patch: PmSettingsPatch) => void;
}

/** First-run setup: mandate, monthly budget, queue cap. Saving also turns the agent on. */
export const SetupPanel: React.FC<SetupPanelProps> = ({ state, saving, onSave }) => {
  const [mandate, setMandate] = useState(state.settings.mandate || copy.setupDefaultMandate);
  const [budget, setBudget] = useState<string>(String(state.settings.monthlyBudgetUsd ?? 100));
  const [cap, setCap] = useState<string>(String(state.settings.queueCap ?? 5));
  const [errors, setErrors] = useState<{ mandate?: string; budget?: string; cap?: string }>({});

  const submit = () => {
    const next: typeof errors = {};
    const b = Number(budget);
    const c = Number(cap);
    if (!mandate.trim()) next.mandate = copy.agent.mandateRequired;
    if (budget.trim() === "" || Number.isNaN(b) || b < 0) next.budget = copy.agent.invalidBudget;
    if (!Number.isInteger(c) || c < 1 || c > 10) next.cap = copy.agent.invalidCap;
    setErrors(next);
    if (Object.keys(next).length) return;
    onSave({ mandate: mandate.trim(), monthlyBudgetUsd: b, queueCap: c, enabled: true });
  };

  return (
    <section
      aria-label={copy.setupTitle}
      className="flex max-w-2xl flex-col gap-4 rounded border border-neutral-500 p-4"
    >
      <h2 className="text-xl font-semibold text-typography-900">{copy.setupTitle}</h2>
      <p className="text-sm text-typography-700">{copy.setupBody}</p>
      <TextArea
        id="pm-setup-mandate"
        labelText={copy.setupMandate}
        helperText={copy.setupMandateHelp}
        rows={4}
        value={mandate}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMandate(e.target.value)}
        invalid={Boolean(errors.mandate)}
        invalidText={errors.mandate ?? ""}
      />
      <div className="flex flex-wrap gap-4">
        <NumberInput
          id="pm-setup-budget"
          label={copy.setupBudget}
          min={0}
          step={10}
          allowEmpty
          value={budget}
          onChange={(_e: unknown, { value }: { value: number | string }) =>
            setBudget(String(value))
          }
          invalid={Boolean(errors.budget)}
          invalidText={errors.budget ?? ""}
        />
        <NumberInput
          id="pm-setup-cap"
          label={copy.setupCap}
          min={1}
          max={10}
          allowEmpty
          value={cap}
          onChange={(_e: unknown, { value }: { value: number | string }) => setCap(String(value))}
          invalid={Boolean(errors.cap)}
          invalidText={errors.cap ?? ""}
        />
      </div>
      <div>
        <Button size="md" disabled={saving} onClick={submit}>
          {copy.setupStart}
        </Button>
      </div>
    </section>
  );
};

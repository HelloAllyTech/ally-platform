import React, { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  Button,
  CarbonToggle,
  InlineNotification,
  NumberInput,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  SkeletonText,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import {
  useGetBuilderRepoMapsQuery,
  useGetBuilderSettingsQuery,
  useGetLlmModelsQuery,
  useUpdateBuilderSettingsMutation,
} from "@api";
import { TooltipIcon } from "@assets";
import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
import { en, ROUTES } from "@constants";
import { BuilderAutonomyLevel, BuilderSettings as BuilderSettingsType } from "@types";
import { formatDate, formatRelativeTime } from "@utils";

/** Local editable copy of the fields this page actually exposes. */
type SettingsDraft = Pick<
  BuilderSettingsType,
  | "enabled"
  | "autoReviewEnabled"
  | "autoApproveEnabled"
  | "autoMergeEnabled"
  | "autoReleaseEnabled"
  | "autoFixEnabled"
  | "maxFixRunsPerPr"
  | "maxPrAutomationUsd"
  | "maxConcurrentBuilds"
  | "defaultBudgetUsd"
  | "plannerModel"
  | "coderModel"
  | "verifierModel"
>;

/** The switches a level sets together. */
type AutonomySwitches = Pick<
  SettingsDraft,
  | "autoReviewEnabled"
  | "autoFixEnabled"
  | "autoApproveEnabled"
  | "autoMergeEnabled"
  | "autoReleaseEnabled"
>;
type SelectableLevel = Exclude<BuilderAutonomyLevel, "custom">;

const LEVELS: SelectableLevel[] = ["off", "assist", "auto_merge", "auto"];

/**
 * What each level means in switches — the server's own mapping, mirrored so
 * the Advanced switches show the effect of a level the moment it is picked.
 * The server is still the one that applies it (Save sends the level, not
 * these).
 */
const LEVEL_SWITCHES: Record<SelectableLevel, AutonomySwitches> = {
  off: {
    autoReviewEnabled: false,
    autoFixEnabled: false,
    autoApproveEnabled: false,
    autoMergeEnabled: false,
    autoReleaseEnabled: false,
  },
  assist: {
    autoReviewEnabled: true,
    autoFixEnabled: true,
    autoApproveEnabled: true,
    autoMergeEnabled: false,
    autoReleaseEnabled: false,
  },
  auto_merge: {
    autoReviewEnabled: true,
    autoFixEnabled: true,
    autoApproveEnabled: true,
    autoMergeEnabled: true,
    autoReleaseEnabled: false,
  },
  auto: {
    autoReviewEnabled: true,
    autoFixEnabled: true,
    autoApproveEnabled: true,
    autoMergeEnabled: true,
    autoReleaseEnabled: true,
  },
};

const SWITCH_KEYS = Object.keys(LEVEL_SWITCHES.off) as (keyof AutonomySwitches)[];

/** The level a mix of switches amounts to; anything else is `custom`. */
const levelOf = (draft: AutonomySwitches): BuilderAutonomyLevel =>
  LEVELS.find(level => SWITCH_KEYS.every(key => LEVEL_SWITCHES[level][key] === draft[key])) ??
  "custom";

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-medium text-typography-900">{label}</span>
      {hint && (
        <Tooltip label={hint} align="top">
          <button
            type="button"
            className="-m-1 inline-flex cursor-pointer items-center p-1 md:m-0 md:p-0"
          >
            <TooltipIcon />
          </button>
        </Tooltip>
      )}
    </div>
    {children}
  </div>
);

/**
 * Platform-wide Builder controls: the kill switch, the concurrency ceiling,
 * the default spend cap, and the per-tier model defaults — everything a
 * per-build override in `StartBuildDialog` sits above (session override →
 * these → the runner's own hardcoded fallback).
 *
 * Read-only repo-map freshness lives here too rather than as its own page:
 * it's the one piece of context worth checking before turning Builder back on
 * after an incident — a stale map means the agent's read of a repo may not
 * reflect what actually merged since.
 */
export const BuilderSettings: React.FC = () => {
  const strings = en.builder.settings;
  const autonomy = strings.autonomy;
  const navigate = useNavigate();

  const { data, isLoading, isError } = useGetBuilderSettingsQuery();
  const { data: repoMapsData } = useGetBuilderRepoMapsQuery();
  const [updateSettings, { isLoading: isSaving }] = useUpdateBuilderSettingsMutation();
  const { data: models = [] } = useGetLlmModelsQuery();

  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [level, setLevel] = useState<BuilderAutonomyLevel>("custom");
  // True once a level was picked here and the switches not touched since: Save
  // then sends the level, and the server sets the switches from it.
  const [levelPicked, setLevelPicked] = useState(false);
  // Auto is the one level that ships to users unasked, so choosing it — from
  // the selector or the suggestion — goes through a confirmation first.
  const [confirmAuto, setConfirmAuto] = useState<null | "pick" | "apply">(null);

  useEffect(() => {
    if (data) {
      setLevel(
        data.autonomyLevel ??
          levelOf({
            autoReviewEnabled: data.autoReviewEnabled,
            autoFixEnabled: data.autoFixEnabled,
            autoApproveEnabled: data.autoApproveEnabled,
            autoMergeEnabled: data.autoMergeEnabled,
            autoReleaseEnabled: data.autoReleaseEnabled,
          }),
      );
      setLevelPicked(false);
      setDraft({
        enabled: data.enabled,
        autoReviewEnabled: data.autoReviewEnabled,
        autoApproveEnabled: data.autoApproveEnabled,
        autoMergeEnabled: data.autoMergeEnabled,
        autoReleaseEnabled: data.autoReleaseEnabled,
        autoFixEnabled: data.autoFixEnabled,
        maxFixRunsPerPr: data.maxFixRunsPerPr,
        maxPrAutomationUsd: data.maxPrAutomationUsd,
        maxConcurrentBuilds: data.maxConcurrentBuilds,
        defaultBudgetUsd: data.defaultBudgetUsd,
        plannerModel: data.plannerModel,
        coderModel: data.coderModel,
        verifierModel: data.verifierModel,
      });
    }
  }, [data]);

  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) =>
    setDraft(current => (current ? { ...current, [key]: value } : current));

  /** A hand-set switch takes over from a picked level: Save sends switches again. */
  const setSwitch = (key: keyof AutonomySwitches, value: boolean) => {
    if (!draft) return;
    const next = { ...draft, [key]: value };
    setDraft(next);
    setLevel(levelOf(next));
    setLevelPicked(false);
  };

  const pickLevel = (next: SelectableLevel) => {
    setLevel(next);
    setLevelPicked(true);
    setDraft(current => (current ? { ...current, ...LEVEL_SWITCHES[next] } : current));
  };

  /** The suggestion's button: applied straight away, not via Save. */
  const applyLevel = async (next: SelectableLevel) => {
    try {
      await updateSettings({ autonomyLevel: next }).unwrap();
      toast.success(autonomy.switched(autonomy.levels[next].name));
    } catch {
      toast.error(strings.saveFailed);
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    try {
      await updateSettings({
        enabled: draft.enabled,
        // A picked level is sent as the level, and the server sets the
        // switches from it; otherwise the switches go as they stand.
        ...(levelPicked && level !== "custom"
          ? { autonomyLevel: level }
          : {
              autoReviewEnabled: draft.autoReviewEnabled,
              autoApproveEnabled: draft.autoApproveEnabled,
              autoMergeEnabled: draft.autoMergeEnabled,
              autoReleaseEnabled: draft.autoReleaseEnabled,
              autoFixEnabled: draft.autoFixEnabled,
            }),
        maxFixRunsPerPr: draft.maxFixRunsPerPr,
        // Undefined only when the server does not know the field yet — then it
        // is left alone rather than sent as 0, which would lift the limit.
        ...(draft.maxPrAutomationUsd !== undefined
          ? { maxPrAutomationUsd: Number(draft.maxPrAutomationUsd || 0) }
          : {}),
        maxConcurrentBuilds: draft.maxConcurrentBuilds,
        ...(draft.defaultBudgetUsd !== null
          ? { defaultBudgetUsd: Number(draft.defaultBudgetUsd) }
          : {}),
        // "" clears a tier back to the platform default — see api/builder.ts.
        plannerModel: draft.plannerModel ?? "",
        coderModel: draft.coderModel ?? "",
        verifierModel: draft.verifierModel ?? "",
      }).unwrap();
      toast.success(strings.saved);
    } catch {
      toast.error(strings.saveFailed);
    }
  };

  const repoMaps = repoMapsData?.maps ?? [];

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto md:p-6">
      <header>
        <Button kind="ghost" size="sm" onClick={() => navigate(ROUTES.BUILDER)}>
          ← {strings.backToBuilder}
        </Button>
        <h1 className="mt-2 text-xl font-semibold text-typography-900">{strings.title}</h1>
        <p className="mt-1 text-sm text-typography-600">{strings.subtitle}</p>
      </header>

      {isError && (
        <InlineNotification kind="error" lowContrast hideCloseButton title={strings.loadFailed} />
      )}

      {isLoading || !draft ? (
        <SkeletonText paragraph lineCount={10} />
      ) : (
        <>
          {/* The kill switch sits first and alone, same as WhatsApp's settings
              page — it's the control someone reaches for in an incident and
              shouldn't be buried under thresholds. */}
          <section className="rounded-md border border-border-light p-4">
            <CarbonToggle
              id="builder-settings-enabled"
              labelText={strings.enabledLabel}
              size="sm"
              toggled={draft.enabled}
              onToggle={(checked: boolean) => set("enabled", checked)}
            />
            <p className="pt-1 text-xs text-typography-500">{strings.enabledHelp}</p>
          </section>

          {/* One control for how much Builder does on its own, ordered by how
              much it lets go of. Stacks, "Design autonomy sliders to build user
              trust" and "Progressive Delegation": a level a person can read in
              one line beats five interacting switches, and each step up names
              what it risks ("communicate risks and benefits"). The switches
              stay, under Advanced, for a mix no level describes. */}
          <section className="rounded-md border border-border-light p-4">
            <h2 className="text-sm font-medium text-typography-900">{autonomy.heading}</h2>
            <RadioButtonGroup
              name="builder-autonomy-level"
              legendText=""
              orientation="vertical"
              className="mt-2"
              valueSelected={level}
              onChange={(value: unknown) => {
                const next = value as SelectableLevel;
                if (next === "auto") setConfirmAuto("pick");
                else pickLevel(next);
              }}
            >
              {[
                ...LEVELS.map(option => (
                  <RadioButton
                    key={option}
                    id={`builder-autonomy-${option}`}
                    value={option}
                    labelText={
                      <span className="flex flex-col">
                        <span className="font-medium">
                          {autonomy.levels[option].name}
                          {option === "assist" ? ` · ${autonomy.recommended}` : ""}
                        </span>
                        <span className="text-xs text-typography-600">
                          {autonomy.levels[option].description}
                        </span>
                        {autonomy.levels[option].risk && (
                          <span className="text-xs text-typography-500">
                            {autonomy.levels[option].risk}
                          </span>
                        )}
                      </span>
                    }
                  />
                )),
                // Only offered when it is the truth: custom is what the
                // switches add up to, not something to pick.
                ...(level === "custom"
                  ? [
                      <RadioButton
                        key="custom"
                        id="builder-autonomy-custom"
                        value="custom"
                        disabled
                        labelText={autonomy.custom}
                      />,
                    ]
                  : []),
              ]}
            </RadioButtonGroup>
            {level === "custom" && (
              <p className="pt-1 text-xs text-typography-500">{autonomy.customHint}</p>
            )}

            {/* A spend ceiling per pull request belongs with how much Builder
                does on its own: it is the other half of how far it may go. */}
            <div className="mt-3 border-t border-border-light pt-3">
              <Field label={autonomy.maxPrSpendLabel}>
                <NumberInput
                  id="builder-settings-max-pr-spend"
                  label={autonomy.maxPrSpendLabel}
                  hideLabel
                  hideSteppers
                  min={0}
                  placeholder={autonomy.maxPrSpendPlaceholder}
                  value={
                    Number(draft.maxPrAutomationUsd) > 0 ? Number(draft.maxPrAutomationUsd) : ""
                  }
                  onChange={(_event: unknown, state: { value: number | string } | undefined) =>
                    set(
                      "maxPrAutomationUsd",
                      state?.value === undefined || state.value === "" ? null : String(state.value),
                    )
                  }
                />
              </Field>
              <p className="pt-1 text-xs text-typography-500">{autonomy.maxPrSpendHint}</p>
            </div>

            {data?.trackRecord && (
              <p className="mt-3 border-t border-border-light pt-3 text-xs text-typography-600">
                {data.trackRecord.window > 0
                  ? autonomy.trackRecord(
                      data.trackRecord.window,
                      data.trackRecord.cleanReviewed,
                      data.trackRecord.mergedAsReviewed,
                      data.trackRecord.escalated,
                      data.trackRecord.unhealthyReleases,
                    )
                  : autonomy.trackRecordEmpty}
              </p>
            )}
            {/* Quiet on purpose: the record earns a suggestion, never a switch. */}
            {data?.suggestedLevel && data.suggestedLevel !== level && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-typography-600">
                <span>{autonomy.suggestion(autonomy.levels[data.suggestedLevel].name)}</span>
                <Button
                  kind="tertiary"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => {
                    const next = data.suggestedLevel as SelectableLevel;
                    if (next === "auto") setConfirmAuto("apply");
                    else void applyLevel(next);
                  }}
                >
                  {autonomy.switchTo(autonomy.levels[data.suggestedLevel].name)}
                </Button>
              </div>
            )}
          </section>

          {/* Open by default only when the switches are a mix no level names —
              then they are the setting, and hiding them would hide it. */}
          <details
            className="rounded-md border border-border-light"
            open={data?.autonomyLevel === "custom" || undefined}
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-typography-900">
              {autonomy.advanced}
            </summary>
            <div className="flex flex-col gap-4 px-4 pb-4">
              {/* Ordered by how much they let go of, not by when they were built:
                  review only reads, approve vouches for the result, fix writes to
                  a branch someone may be reading. Each is independent, so the
                  middle setting — findings land, nothing pushes — is reachable. */}
              <section className="rounded-md border border-border-light p-4">
                <CarbonToggle
                  id="builder-settings-auto-review"
                  labelText={strings.autoReviewLabel}
                  size="sm"
                  toggled={draft.autoReviewEnabled}
                  onToggle={(checked: boolean) => setSwitch("autoReviewEnabled", checked)}
                />
                <p className="pt-1 text-xs text-typography-500">{strings.autoReviewHelp}</p>
                {draft.autoReviewEnabled && (
                  <div className="mt-3 border-t border-border-light pt-3">
                    <CarbonToggle
                      id="builder-settings-auto-approve"
                      labelText={strings.autoApproveLabel}
                      size="sm"
                      toggled={draft.autoApproveEnabled}
                      onToggle={(checked: boolean) => setSwitch("autoApproveEnabled", checked)}
                    />
                    <p className="pt-1 text-xs text-typography-500">{strings.autoApproveHelp}</p>

                    {/* Nested one level deeper again. Neither of these is a
                        setting anyone should be able to reach by accident, and the
                        ladder — read, vouch, take, ship — is the whole shape of how
                        much each switch lets go of.

                        Siblings rather than a further nesting: merging is Builder
                        taking the work itself, releasing is what happens to a
                        merged pull request whoever merged it. Hanging release off
                        merge would say a hand-merged one does not release, which is
                        not true. */}
                    {draft.autoApproveEnabled && (
                      <div className="mt-3 border-t border-border-light pt-3">
                        <CarbonToggle
                          id="builder-settings-auto-merge"
                          labelText={strings.autoMergeLabel}
                          size="sm"
                          toggled={draft.autoMergeEnabled}
                          onToggle={(checked: boolean) => setSwitch("autoMergeEnabled", checked)}
                        />
                        <p className="pt-1 text-xs text-typography-500">{strings.autoMergeHelp}</p>

                        <div className="mt-3 border-t border-border-light pt-3">
                          <CarbonToggle
                            id="builder-settings-auto-release"
                            labelText={strings.autoReleaseLabel}
                            size="sm"
                            toggled={draft.autoReleaseEnabled}
                            onToggle={(checked: boolean) =>
                              setSwitch("autoReleaseEnabled", checked)
                            }
                          />
                          <p className="pt-1 text-xs text-typography-500">
                            {strings.autoReleaseHelp}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Next to the kill switch, not under the thresholds. This decides
                  whether an agent may push commits to a pull request a person is
                  in the middle of reviewing — which makes it the second most
                  consequential control here, and it had no control at all until
                  now: the field existed, the API accepted it, and the only way to
                  change it was a hand-written PATCH. */}
              <section className="rounded-md border border-border-light p-4">
                <CarbonToggle
                  id="builder-settings-auto-fix"
                  labelText={strings.autoFixLabel}
                  size="sm"
                  toggled={draft.autoFixEnabled}
                  onToggle={(checked: boolean) => setSwitch("autoFixEnabled", checked)}
                />
                <p className="pt-1 text-xs text-typography-500">{strings.autoFixHelp}</p>
                {draft.autoFixEnabled && (
                  <div className="pt-3">
                    <Field label={strings.maxFixRunsPerPrLabel} hint={strings.maxFixRunsPerPrHelp}>
                      <NumberInput
                        id="builder-settings-max-fix-runs"
                        label={strings.maxFixRunsPerPrLabel}
                        hideLabel
                        hideSteppers
                        min={0}
                        max={10}
                        value={draft.maxFixRunsPerPr}
                        onChange={(
                          _event: unknown,
                          state: { value: number | string } | undefined,
                        ) => {
                          const next = Number(state?.value);
                          if (!Number.isNaN(next)) set("maxFixRunsPerPr", next);
                        }}
                      />
                    </Field>
                  </div>
                )}
              </section>
            </div>
          </details>

          <section className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={strings.maxConcurrentBuildsLabel}
                hint={strings.maxConcurrentBuildsHelp}
              >
                <NumberInput
                  id="builder-settings-max-concurrent"
                  label={strings.maxConcurrentBuildsLabel}
                  hideLabel
                  hideSteppers
                  min={1}
                  max={20}
                  value={draft.maxConcurrentBuilds}
                  onChange={(_event: unknown, state: { value: number | string } | undefined) => {
                    const next = Number(state?.value);
                    if (!Number.isNaN(next)) set("maxConcurrentBuilds", next);
                  }}
                />
              </Field>
              <Field label={strings.defaultBudgetLabel} hint={strings.defaultBudgetHelp}>
                <NumberInput
                  id="builder-settings-default-budget"
                  label={strings.defaultBudgetLabel}
                  hideLabel
                  hideSteppers
                  min={0}
                  value={draft.defaultBudgetUsd ?? ""}
                  onChange={(_event: unknown, state: { value: number | string } | undefined) =>
                    set(
                      "defaultBudgetUsd",
                      state?.value === undefined || state.value === "" ? null : String(state.value),
                    )
                  }
                />
              </Field>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-secondary text-typography-900">
                {strings.modelsHeading}
              </h3>
              <Tooltip label={strings.modelsHelp} align="top">
                <button
                  type="button"
                  className="-m-1 inline-flex cursor-pointer items-center p-1 md:m-0 md:p-0"
                >
                  <TooltipIcon />
                </button>
              </Tooltip>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Picked from the catalog rather than typed. A tier is a model
                  id the runner passes straight to the CLI, so a typo used to
                  reach production and fail at dispatch — ally-be's preflight
                  now rejects an unknown model, but refusing a build is a worse
                  answer than not offering the mistake. Empty means the platform
                  default, which is why every list carries a blank first row. */}
              {(
                [
                  ["plannerModel", "builder-settings-planner-model", strings.plannerModelLabel],
                  ["coderModel", "builder-settings-coder-model", strings.coderModelLabel],
                  ["verifierModel", "builder-settings-verifier-model", strings.verifierModelLabel],
                ] as const
              ).map(([field, id, label]) => (
                <Select
                  key={field}
                  id={id}
                  labelText={label}
                  value={draft[field] ?? ""}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                    set(field, event.target.value || null)
                  }
                >
                  <SelectItem value="" text={strings.modelPlaceholder} />
                  {/* A tier already pointing at something the catalog no longer
                      offers keeps its own row, so opening this page cannot
                      silently reset a deliberate choice. */}
                  {draft[field] && !models.some(model => model.model === draft[field]) ? (
                    <SelectItem value={draft[field] as string} text={draft[field] as string} />
                  ) : null}
                  {models.map(model => (
                    <SelectItem
                      key={model.model}
                      value={model.model}
                      text={model.label ? `${model.label} (${model.model})` : model.model}
                    />
                  ))}
                </Select>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-secondary text-typography-900">
                {strings.repoMapsHeading}
              </h3>
              <Tooltip label={strings.repoMapsHelp} align="top">
                <button
                  type="button"
                  className="-m-1 inline-flex cursor-pointer items-center p-1 md:m-0 md:p-0"
                >
                  <TooltipIcon />
                </button>
              </Tooltip>
            </div>
            {repoMaps.length === 0 ? (
              <p className="text-sm text-typography-500">{strings.repoMapNeverGenerated}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {repoMaps.map(map => (
                  <li
                    key={map.repo}
                    className="flex items-center justify-between gap-2 border-b border-border-light py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-typography-900">
                      {map.repo}
                    </span>
                    <span
                      className="shrink-0 text-xs text-typography-500"
                      title={map.generatedAt ? formatDate(map.generatedAt) : undefined}
                    >
                      {map.generatedAt && map.commitSha
                        ? strings.repoMapGeneratedAt(
                            formatRelativeTime(map.generatedAt),
                            map.commitSha.slice(0, 7),
                          )
                        : strings.repoMapNeverGenerated}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div>
            <Button
              kind="primary"
              className="max-sm:!w-full max-sm:!max-w-none"
              disabled={isSaving}
              onClick={() => void handleSave()}
            >
              {strings.save}
            </Button>
          </div>
        </>
      )}
      <ActionConfirmationPopup
        isOpen={confirmAuto !== null}
        onClose={() => setConfirmAuto(null)}
        title={autonomy.confirmAutoTitle}
        description={autonomy.confirmAutoBody}
        primaryButton={{
          label: autonomy.confirmAutoAction,
          onClick: () => {
            if (confirmAuto === "apply") void applyLevel("auto");
            else pickLevel("auto");
            setConfirmAuto(null);
          },
        }}
        secondaryButton={{ label: autonomy.cancel, onClick: () => setConfirmAuto(null) }}
      />
    </div>
  );
};

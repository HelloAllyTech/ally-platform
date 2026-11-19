import { FC } from "react";

import { Controller, useFormContext, useWatch } from "react-hook-form";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { useGetAssessmentPairCompatQuery } from "@api";
import { TooltipIcon } from "@assets";
import { ToggleSwitch } from "@components";
import { DEFAULT_VIDEO_WATCH_PCT, MAX_VIDEO_WATCH_PCT, MIN_VIDEO_WATCH_PCT } from "@constants";
import {
  AssessmentPhase,
  CompletionCriteria,
  RoleplayCompletionLogic,
  RoleplayType,
  TrackFormValues,
  TrackItemType,
} from "@types";

import {
  DEFAULT_MIN_LEARNER_TURNS,
  MAX_LEARNER_TURNS,
  MIN_LEARNER_TURNS,
  getRoleplayType,
} from "../trackFormUtils";

interface CompletionRuleFieldsProps {
  sectionIndex: number;
  itemIndex: number;
  type: TrackItemType;
  disabled?: boolean;
}

const fieldLabel = "text-xs font-medium text-typography-700";
const numberInput =
  "w-24 border border-border-light rounded-md px-2 py-1 text-sm outline-none focus:border-primary-400 disabled:opacity-60";

export const ROLEPLAY_COMPLETION_LOGIC_OPTIONS: Array<{
  value: RoleplayCompletionLogic;
  label: string;
  hint: string;
}> = [
  {
    value: "SCORE",
    label: "Minimum score",
    hint: "Any length of roleplay counts once the learner reaches the score.",
  },
  {
    value: "DURATION",
    label: "Minimum duration",
    hint: "Any score counts once the roleplay lasts long enough.",
  },
  {
    value: "SCORE_AND_DURATION",
    label: "Minimum score AND duration",
    hint: "The learner needs both the score and the time.",
  },
];

export const ROLEPLAY_TYPE_OPTIONS: Array<{ value: RoleplayType; label: string; hint: string }> = [
  {
    value: "TRIAL",
    label: "Trial",
    hint: "No requirement — completes when the learner starts it.",
  },
  {
    value: "PRACTICE",
    label: "Practice",
    hint: "Retry as often as needed until the score and/or duration bar is met.",
  },
  {
    value: "ASSESSMENT",
    label: "Assessment",
    hint: "One valid attempt. It counts once the learner takes the minimum number of turns; shorter attempts can be restarted.",
  },
];

const ASSESSMENT_USE_OPTIONS: Array<{ value: "STANDALONE" | AssessmentPhase; label: string }> = [
  { value: "STANDALONE", label: "Standalone" },
  { value: "PRE", label: "Pre-assessment" },
  { value: "POST", label: "Post-assessment" },
];

const DEFAULT_LOGIC: RoleplayCompletionLogic = "SCORE_AND_DURATION";

/** Splits a total in seconds into the minutes and seconds the fields show. */
export const splitDuration = (
  total: number | undefined,
): { minutes: number | undefined; seconds: number | undefined } => {
  if (total == null) return { minutes: undefined, seconds: undefined };
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
};

/**
 * Combines the two fields into total seconds, which is what the server
 * stores. Both blank means "use the platform default" (undefined); one blank
 * reads as 0.
 */
export const combineDuration = (
  minutes: number | undefined,
  seconds: number | undefined,
): number | undefined => {
  if (minutes == null && seconds == null) return undefined;
  return Math.max(0, Math.floor(minutes ?? 0)) * 60 + Math.max(0, Math.floor(seconds ?? 0));
};

interface RoleplayGateFieldsProps {
  base: `sections.${number}.items.${number}.completionCriteria`;
  sectionIndex: number;
  itemIndex: number;
  disabled: boolean;
  toNumber: (raw: string) => number | undefined;
}

const helpButton = (
  <button type="button" className="cursor-pointer inline-flex items-center">
    <TooltipIcon />
  </button>
);

const oppositePhase = (phase: AssessmentPhase): AssessmentPhase =>
  phase === "PRE" ? "POST" : "PRE";

/** A roleplay candidate for pairing: another assessment roleplay in the same course. */
interface PairCandidate {
  sectionIndex: number;
  itemIndex: number;
  label: string;
  scenarioId: number | null | undefined;
  criteria: CompletionCriteria;
}

/**
 * The roleplay's completion requirement: a Trial / Practice / Assessment
 * picker, then only the inputs that type reads. The type is derived from the
 * criteria (see `getRoleplayType`), never stored on its own.
 */
const RoleplayGateFields: FC<RoleplayGateFieldsProps> = ({
  base,
  sectionIndex,
  itemIndex,
  disabled,
  toNumber,
}) => {
  const { control, getValues, setValue } = useFormContext<TrackFormValues>();
  const criteria = (useWatch({ control, name: base }) ?? {}) as CompletionCriteria;
  const sections = useWatch({ control, name: "sections" });
  const type = getRoleplayType(criteria);
  const logic = criteria.completionLogic ?? DEFAULT_LOGIC;
  const practiceLogic = logic === "PARTICIPATION" ? DEFAULT_LOGIC : logic;
  const showScore = practiceLogic === "SCORE" || practiceLogic === "SCORE_AND_DURATION";
  const showDuration = practiceLogic === "DURATION" || practiceLogic === "SCORE_AND_DURATION";
  const selectId = `${base}.completionLogic`;
  const hint = ROLEPLAY_COMPLETION_LOGIC_OPTIONS.find(
    option => option.value === practiceLogic,
  )?.hint;
  const typeHint = ROLEPLAY_TYPE_OPTIONS.find(option => option.value === type)?.hint;

  const criteriaPath = (si: number, ii: number) =>
    `sections.${si}.items.${ii}.completionCriteria` as const;
  const patch = (si: number, ii: number, change: CompletionCriteria) => {
    const path = criteriaPath(si, ii);
    setValue(path, { ...(getValues(path) ?? {}), ...change }, { shouldDirty: true });
  };
  /** Drops phase + key from an item (a partner, or this one). */
  const clearPairing = (si: number, ii: number) => {
    const path = criteriaPath(si, ii);
    const rest: CompletionCriteria = { ...(getValues(path) ?? {}) };
    delete rest.assessmentPhase;
    delete rest.assessmentPairKey;
    setValue(path, rest, { shouldDirty: true });
  };

  /* ----- pairing ----- */

  const candidates: PairCandidate[] = [];
  (sections ?? []).forEach((section, si) => {
    (section.items ?? []).forEach((item, ii) => {
      if (si === sectionIndex && ii === itemIndex) return;
      if (item.type !== TrackItemType.ROLEPLAY) return;
      if (getRoleplayType(item.completionCriteria) !== "ASSESSMENT") return;
      candidates.push({
        sectionIndex: si,
        itemIndex: ii,
        label: `${item.title?.trim() || item.refTitle || "Untitled roleplay"}${
          section.title ? ` (${section.title})` : ""
        }`,
        scenarioId: item.scenarioId,
        criteria: item.completionCriteria ?? {},
      });
    });
  });
  const pairKey = criteria.assessmentPairKey;
  const partner = pairKey
    ? candidates.find(candidate => candidate.criteria.assessmentPairKey === pairKey)
    : undefined;
  // Another item's pair is not ours to steal; only unpaired ones (and our own partner) are offered.
  const offered = candidates.filter(
    candidate => !candidate.criteria.assessmentPairKey || candidate === partner,
  );
  const useAs: "STANDALONE" | AssessmentPhase = criteria.assessmentPhase ?? "STANDALONE";
  const partnerKey = partner ? `${partner.sectionIndex}:${partner.itemIndex}` : "";

  const ownScenarioId = (sections?.[sectionIndex]?.items?.[itemIndex]?.scenarioId ?? null) as
    | number
    | null;
  const phaseOf = (c: CompletionCriteria) => c.assessmentPhase;
  const preScenario = partner
    ? phaseOf(criteria) === "PRE"
      ? ownScenarioId
      : partner.scenarioId
    : null;
  const postScenario = partner
    ? phaseOf(criteria) === "POST"
      ? ownScenarioId
      : partner.scenarioId
    : null;
  const canCompare = partner != null && preScenario != null && postScenario != null;
  const { data: compat } = useGetAssessmentPairCompatQuery(
    { preScenarioId: preScenario as number, postScenarioId: postScenario as number },
    { skip: !canCompare },
  );

  const applyResultsDefault = (si: number, ii: number, phase: AssessmentPhase) =>
    patch(si, ii, { showResultsToLearner: phase === "POST" });

  const handleUseAs = (next: "STANDALONE" | AssessmentPhase) => {
    if (next === "STANDALONE") {
      if (partner) clearPairing(partner.sectionIndex, partner.itemIndex);
      clearPairing(sectionIndex, itemIndex);
      return;
    }
    patch(sectionIndex, itemIndex, { assessmentPhase: next });
    if (partner) {
      patch(partner.sectionIndex, partner.itemIndex, { assessmentPhase: oppositePhase(next) });
      applyResultsDefault(sectionIndex, itemIndex, next);
      applyResultsDefault(partner.sectionIndex, partner.itemIndex, oppositePhase(next));
    }
  };

  const handlePairedWith = (value: string) => {
    if (partner) clearPairing(partner.sectionIndex, partner.itemIndex);
    if (!value) {
      clearPairing(sectionIndex, itemIndex);
      return;
    }
    const [si, ii] = value.split(":").map(Number);
    const target = candidates.find(c => c.sectionIndex === si && c.itemIndex === ii);
    if (!target) return;
    // The earlier item in course order is the pre unless the author already chose a role.
    const earlier = sectionIndex < si || (sectionIndex === si && itemIndex < ii) ? "own" : "target";
    const ownPhase: AssessmentPhase =
      criteria.assessmentPhase ?? (earlier === "own" ? "PRE" : "POST");
    const key = crypto.randomUUID();
    patch(sectionIndex, itemIndex, { assessmentPhase: ownPhase, assessmentPairKey: key });
    patch(si, ii, { assessmentPhase: oppositePhase(ownPhase), assessmentPairKey: key });
    applyResultsDefault(sectionIndex, itemIndex, ownPhase);
    applyResultsDefault(si, ii, oppositePhase(ownPhase));
  };

  /* ----- type switch ----- */

  const handleType = (next: RoleplayType) => {
    if (next === type) return;
    // Leaving assessment (or being re-typed) must not strand the partner half-paired.
    if (partner) clearPairing(partner.sectionIndex, partner.itemIndex);
    const path = criteriaPath(sectionIndex, itemIndex);
    const current = getValues(path) ?? {};
    // Keep the non-roleplay keys (nothing today) and rebuild the roleplay rule.
    const { minScore, minDurationSeconds } = current;
    let rule: CompletionCriteria;
    if (next === "TRIAL") {
      rule = { completionLogic: "PARTICIPATION" };
    } else if (next === "PRACTICE") {
      rule = {
        completionLogic: type === "TRIAL" ? DEFAULT_LOGIC : practiceLogic,
        ...(minScore != null ? { minScore } : {}),
        ...(minDurationSeconds != null ? { minDurationSeconds } : {}),
      };
    } else {
      rule = {
        assessmentMode: true,
        completionLogic: "SCORE",
        minLearnerTurns: DEFAULT_MIN_LEARNER_TURNS,
        showResultsToLearner: true,
      };
    }
    setValue(path, rule, { shouldDirty: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1">
          <span id={`${base}.type-label`} className={fieldLabel}>
            Roleplay type
          </span>
          <Tooltip
            label="What a learner's roleplay attempt must reach before this item counts as complete and the next one unlocks. Everything here can be changed after learners have enrolled: it applies from their next attempt and never undoes an item they have already completed."
            align="top"
          >
            {helpButton}
          </Tooltip>
        </span>
        <div
          role="radiogroup"
          aria-labelledby={`${base}.type-label`}
          className="inline-flex w-fit overflow-hidden rounded-md border border-border-light"
        >
          {ROLEPLAY_TYPE_OPTIONS.map(option => (
            <Tooltip key={option.value} label={option.hint} align="top">
              <button
                type="button"
                role="radio"
                aria-checked={type === option.value}
                disabled={disabled}
                onClick={() => handleType(option.value)}
                className={`px-4 py-1.5 text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                  type === option.value
                    ? "bg-primary-500 text-white"
                    : "bg-white text-typography-700 hover:bg-neutral-100"
                }`}
              >
                {option.label}
              </button>
            </Tooltip>
          ))}
        </div>
        {typeHint && <span className="text-xs text-typography-500">{typeHint}</span>}
      </div>

      {type === "PRACTICE" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={selectId} className={fieldLabel}>
            Completion requirement
          </label>
          <Controller
            control={control}
            name={`${base}.completionLogic`}
            render={({ field }) => (
              <select
                id={selectId}
                disabled={disabled}
                className="w-72 border border-border-light rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary-400 disabled:opacity-60"
                value={practiceLogic}
                onChange={event => field.onChange(event.target.value as RoleplayCompletionLogic)}
              >
                {ROLEPLAY_COMPLETION_LOGIC_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          />
          {hint && <span className="text-xs text-typography-500">{hint}</span>}
        </div>
      )}

      {type === "PRACTICE" && showScore && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${base}.minScore`} className={fieldLabel}>
            Minimum score (0 or above, optional)
          </label>
          <Controller
            control={control}
            name={`${base}.minScore`}
            render={({ field }) => (
              <input
                id={`${base}.minScore`}
                type="number"
                min={0}
                disabled={disabled}
                className={numberInput}
                value={field.value ?? ""}
                onChange={event => field.onChange(toNumber(event.target.value))}
                onWheel={event => event.currentTarget.blur()}
              />
            )}
          />
          <span className="text-xs text-typography-500">
            Learner must reach this score to complete this roleplay. Leave blank to let any attempt
            unlock the next item, regardless of score.
          </span>
        </div>
      )}

      {type === "PRACTICE" && showDuration && (
        <Controller
          control={control}
          name={`${base}.minDurationSeconds`}
          render={({ field }) => {
            const { minutes, seconds } = splitDuration(field.value);
            return (
              <fieldset className="flex flex-col gap-1" disabled={disabled}>
                <legend className={fieldLabel}>Minimum duration</legend>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    aria-label="Minimum duration minutes"
                    className={numberInput}
                    value={minutes ?? ""}
                    onChange={event =>
                      field.onChange(combineDuration(toNumber(event.target.value), seconds))
                    }
                    onWheel={event => event.currentTarget.blur()}
                  />
                  <span className="text-xs text-typography-700">min</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    step={1}
                    aria-label="Minimum duration seconds"
                    className={numberInput}
                    value={seconds ?? ""}
                    onChange={event =>
                      field.onChange(combineDuration(minutes, toNumber(event.target.value)))
                    }
                    onWheel={event => event.currentTarget.blur()}
                  />
                  <span className="text-xs text-typography-700">sec</span>
                </div>
                <span className="text-xs text-typography-500">
                  How long the roleplay must last. Leave both blank to use the platform default (3
                  minutes); enter 0 for no minimum.
                </span>
              </fieldset>
            );
          }}
        />
      )}

      {type === "ASSESSMENT" && (
        <>
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1">
              <label htmlFor={`${base}.minLearnerTurns`} className={fieldLabel}>
                Minimum learner turns
              </label>
              <Tooltip
                label="A turn is one thing the learner says. Shorter attempts don't count and can be restarted."
                align="top"
              >
                {helpButton}
              </Tooltip>
            </span>
            <Controller
              control={control}
              name={`${base}.minLearnerTurns`}
              render={({ field }) => (
                <input
                  id={`${base}.minLearnerTurns`}
                  type="number"
                  min={MIN_LEARNER_TURNS}
                  max={MAX_LEARNER_TURNS}
                  step={1}
                  disabled={disabled}
                  placeholder={String(DEFAULT_MIN_LEARNER_TURNS)}
                  className={numberInput}
                  value={field.value ?? ""}
                  onChange={event => field.onChange(toNumber(event.target.value))}
                  onWheel={event => event.currentTarget.blur()}
                />
              )}
            />
            <span className="text-xs text-typography-500">
              A turn is one thing the learner says. Shorter attempts don&apos;t count and can be
              restarted.
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1">
              <label htmlFor={`${base}.minScore`} className={fieldLabel}>
                Pass mark (0 or above, optional)
              </label>
              <Tooltip
                label="If set, a learner whose submitted attempt scores below it stays paused at this item until a trainer reopens the attempt. Leave blank to let any submitted attempt unlock the next item."
                align="top"
              >
                {helpButton}
              </Tooltip>
            </span>
            <Controller
              control={control}
              name={`${base}.minScore`}
              render={({ field }) => (
                <input
                  id={`${base}.minScore`}
                  type="number"
                  min={0}
                  disabled={disabled}
                  className={numberInput}
                  value={field.value ?? ""}
                  onChange={event => field.onChange(toNumber(event.target.value))}
                  onWheel={event => event.currentTarget.blur()}
                />
              )}
            />
            {criteria.assessmentPhase === "PRE" && (criteria.minScore ?? 0) > 0 && (
              <span role="alert" className="text-xs text-warning-text">
                A pass mark on a pre-assessment pauses the course for learners who miss it.
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1">
                <span className={fieldLabel}>Show results to learner</span>
                <Tooltip
                  label="Turn this off for a baseline the learner shouldn't see the score of. Trainers always see results in Analytics."
                  align="top"
                >
                  {helpButton}
                </Tooltip>
              </span>
              <span className="text-xs text-typography-500">
                Off: the learner sees &apos;Submitted&apos; with no score or debrief. Trainers
                always see results.
              </span>
            </div>
            <Controller
              control={control}
              name={`${base}.showResultsToLearner`}
              render={({ field }) => (
                <ToggleSwitch
                  enabled={field.value ?? true}
                  onChange={field.onChange}
                  disabled={disabled}
                  label="Show results to learner"
                />
              )}
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1">
                <label htmlFor={`${base}.useAs`} className={fieldLabel}>
                  Use as
                </label>
                <Tooltip
                  label="A pre-assessment is taken before the course content and a post-assessment after it, so trainers can see each learner's gain. The post stays locked until the learner submits the pre."
                  align="top"
                >
                  {helpButton}
                </Tooltip>
              </span>
              <select
                id={`${base}.useAs`}
                disabled={disabled}
                className="w-56 border border-border-light rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary-400 disabled:opacity-60"
                value={useAs}
                onChange={event =>
                  handleUseAs(event.target.value as "STANDALONE" | AssessmentPhase)
                }
              >
                {ASSESSMENT_USE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1">
                <label htmlFor={`${base}.pairedWith`} className={fieldLabel}>
                  Paired with
                </label>
                <Tooltip
                  label="Another assessment roleplay in this course. Pick it here or on that item: both are linked together, and the other one takes the opposite role."
                  align="top"
                >
                  {helpButton}
                </Tooltip>
              </span>
              <select
                id={`${base}.pairedWith`}
                disabled={disabled || offered.length === 0}
                className="w-72 border border-border-light rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary-400 disabled:opacity-60"
                value={partnerKey}
                onChange={event => handlePairedWith(event.target.value)}
              >
                <option value="">{offered.length === 0 ? "No other assessments" : "None"}</option>
                {offered.map(candidate => (
                  <option
                    key={`${candidate.sectionIndex}:${candidate.itemIndex}`}
                    value={`${candidate.sectionIndex}:${candidate.itemIndex}`}
                  >
                    {candidate.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {compat && !compat.comparable && (
            <div role="alert" className="flex flex-col gap-1 text-xs text-warning-text">
              <span>
                These scenarios score different behaviours, so the pre→post gain may not be
                comparable.
              </span>
              {compat.onlyInPre.length > 0 && (
                <span>Only in the pre-assessment: {compat.onlyInPre.join(", ")}</span>
              )}
              {compat.onlyInPost.length > 0 && (
                <span>Only in the post-assessment: {compat.onlyInPost.join(", ")}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Per-item completion criteria editor. Renders only the fields the given item
 * type supports; quiz and annotation pass-scores live in their own settings
 * blocks (mirrored server-side) so they are intentionally absent here, and a
 * game has no completion rule at all — it completes the moment it is opened.
 */
export const CompletionRuleFields: FC<CompletionRuleFieldsProps> = ({
  sectionIndex,
  itemIndex,
  type,
  disabled = false,
}) => {
  const { control } = useFormContext<TrackFormValues>();
  const base = `sections.${sectionIndex}.items.${itemIndex}.completionCriteria` as const;

  const toNumberOrUndefined = (raw: string): number | undefined => {
    if (raw === "") return undefined;
    const value = Number(raw);
    return Number.isNaN(value) ? undefined : value;
  };

  if (
    type === TrackItemType.CASE ||
    type === TrackItemType.QUIZ ||
    type === TrackItemType.ANNOTATED_ARTIFACT ||
    type === TrackItemType.GAME ||
    // Its pass mark and attempts live in the scenario editor strip.
    type === TrackItemType.BRANCHING_SCENARIO ||
    // Completes once every item is placed; nothing to configure.
    type === TrackItemType.BUCKET_SORT
  ) {
    return null;
  }

  return (
    <div className="border-t border-border-light pt-4 mt-4">
      <p className="text-sm font-semibold text-typography-900 mb-3">Completion rule</p>

      {type === TrackItemType.ROLEPLAY && (
        <RoleplayGateFields
          base={base}
          sectionIndex={sectionIndex}
          itemIndex={itemIndex}
          disabled={disabled}
          toNumber={toNumberOrUndefined}
        />
      )}

      {type === TrackItemType.VIDEO && (
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1">
            <label className={fieldLabel}>
              Watch percentage ({MIN_VIDEO_WATCH_PCT}–{MAX_VIDEO_WATCH_PCT}%)
            </label>
            <Tooltip
              label="Percentage of the video a learner must watch before this item counts as complete."
              align="top"
            >
              <button type="button" className="cursor-pointer inline-flex items-center">
                <TooltipIcon />
              </button>
            </Tooltip>
          </span>
          <Controller
            control={control}
            name={`${base}.watchPct`}
            render={({ field }) => {
              const value = field.value ?? DEFAULT_VIDEO_WATCH_PCT;
              return (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={MIN_VIDEO_WATCH_PCT}
                    max={MAX_VIDEO_WATCH_PCT}
                    step={1}
                    disabled={disabled}
                    className="flex-1 accent-primary-500"
                    value={value}
                    onChange={event => field.onChange(Number(event.target.value))}
                  />
                  <span className="text-sm text-typography-800 w-12 text-right">{value}%</span>
                </div>
              );
            }}
          />
        </div>
      )}

      {type === TrackItemType.ARTICLE && (
        <div className="flex flex-col gap-1">
          <label className={fieldLabel}>Minimum read time (seconds, optional)</label>
          <Controller
            control={control}
            name={`${base}.minReadSeconds`}
            render={({ field }) => (
              <input
                type="number"
                min={0}
                disabled={disabled}
                className={numberInput}
                value={field.value ?? ""}
                onChange={event => field.onChange(toNumberOrUndefined(event.target.value))}
                onWheel={event => event.currentTarget.blur()}
              />
            )}
          />
        </div>
      )}

      {type === TrackItemType.JOURNAL && (
        <span className="text-xs text-typography-500">
          Journals are complete once every required prompt has a response.
        </span>
      )}
    </div>
  );
};

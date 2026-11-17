import { FC } from "react";

import { Controller, useFormContext } from "react-hook-form";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { ToggleSwitch } from "@components";
import { DEFAULT_VIDEO_WATCH_PCT, MAX_VIDEO_WATCH_PCT, MIN_VIDEO_WATCH_PCT } from "@constants";
import { TrackFormValues, TrackItemCompletionLogic, TrackItemType } from "@types";

interface CompletionRuleFieldsProps {
  sectionIndex: number;
  itemIndex: number;
  type: TrackItemType;
  disabled?: boolean;
}

const fieldLabel = "text-xs font-medium text-typography-700";
const numberInput =
  "w-24 border border-border-light rounded-md px-2 py-1 text-sm outline-none focus:border-primary-400 disabled:opacity-60";

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
  const { control, watch, setValue } = useFormContext<TrackFormValues>();
  const base = `sections.${sectionIndex}.items.${itemIndex}.completionCriteria` as const;

  const completionLogic =
    watch(`${base}.completionLogic`) || TrackItemCompletionLogic.SCORE_AND_DURATION;
  const minDurationSeconds = watch(`${base}.minDurationSeconds`) || 0;

  const minutes = Math.floor(minDurationSeconds / 60);
  const seconds = minDurationSeconds % 60;

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

  const showScore =
    type === TrackItemType.ROLEPLAY &&
    (completionLogic === TrackItemCompletionLogic.SCORE ||
      completionLogic === TrackItemCompletionLogic.SCORE_AND_DURATION);

  const showDuration =
    type === TrackItemType.ROLEPLAY &&
    (completionLogic === TrackItemCompletionLogic.DURATION ||
      completionLogic === TrackItemCompletionLogic.SCORE_AND_DURATION);

  const completionLogicOptions = [
    { value: TrackItemCompletionLogic.SCORE, label: "Minimum score" },
    { value: TrackItemCompletionLogic.DURATION, label: "Minimum duration" },
    { value: TrackItemCompletionLogic.SCORE_AND_DURATION, label: "Minimum score AND duration" },
    { value: TrackItemCompletionLogic.PARTICIPATION, label: "Participation only" },
  ];

  return (
    <div className="border-t border-border-light pt-4 mt-4">
      <p className="text-sm font-semibold text-typography-900 mb-3">Completion rule</p>

      {type === TrackItemType.ROLEPLAY && (
        <div className="flex flex-col gap-1 mb-4">
          <label className={fieldLabel} htmlFor={`completion-logic-${sectionIndex}-${itemIndex}`}>
            Completion logic
          </label>
          <Controller
            control={control}
            name={`${base}.completionLogic`}
            render={({ field }) => (
              <select
                id={`completion-logic-${sectionIndex}-${itemIndex}`}
                disabled={disabled}
                className="w-full max-w-sm border border-border-light rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary-400 disabled:opacity-60 bg-white"
                value={field.value ?? TrackItemCompletionLogic.SCORE_AND_DURATION}
                onChange={field.onChange}
              >
                {completionLogicOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          />
        </div>
      )}

      {showScore && (
        <div className="flex flex-col gap-1">
          <label className={fieldLabel} htmlFor={`min-score-${sectionIndex}-${itemIndex}`}>
            Minimum score (0 or above, optional)
          </label>
          <Controller
            control={control}
            name={`${base}.minScore`}
            render={({ field }) => (
              <input
                id={`min-score-${sectionIndex}-${itemIndex}`}
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
          <span className="text-xs text-typography-500">
            Learner must reach this score to complete this roleplay. Leave blank to let any attempt
            unlock the next item, regardless of score.
          </span>
        </div>
      )}

      {showDuration && (
        <div className="flex flex-col gap-1 mt-4">
          <label className={fieldLabel} htmlFor={`min-duration-m-${sectionIndex}-${itemIndex}`}>
            Minimum duration
          </label>
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-1">
              <input
                id={`min-duration-m-${sectionIndex}-${itemIndex}`}
                type="number"
                min={0}
                disabled={disabled}
                className={numberInput}
                placeholder="Min"
                value={minutes || ""}
                onChange={event => {
                  const m = Number(event.target.value);
                  setValue(`${base}.minDurationSeconds`, m * 60 + seconds, { shouldDirty: true });
                }}
                onWheel={event => event.currentTarget.blur()}
              />
              <span className="text-[10px] text-typography-500">Minutes</span>
            </div>
            <div className="flex flex-col gap-1">
              <input
                id={`min-duration-s-${sectionIndex}-${itemIndex}`}
                type="number"
                min={0}
                max={59}
                disabled={disabled}
                className={numberInput}
                placeholder="Sec"
                value={seconds || ""}
                onChange={event => {
                  const s = Number(event.target.value);
                  setValue(`${base}.minDurationSeconds`, minutes * 60 + s, { shouldDirty: true });
                }}
                onWheel={event => event.currentTarget.blur()}
              />
              <span className="text-[10px] text-typography-500">Seconds</span>
            </div>
          </div>
          <span className="text-xs text-typography-500 mt-1">
            Learner must stay in the roleplay for at least this long.
          </span>
        </div>
      )}

      {type === TrackItemType.ROLEPLAY &&
        completionLogic === TrackItemCompletionLogic.PARTICIPATION && (
          <span className="text-xs text-typography-500">
            Learners complete this item just by launching it.
          </span>
        )}

      {type === TrackItemType.ROLEPLAY && (
        <div className="flex items-start justify-between gap-4 mt-4">
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1">
              <label
                className={fieldLabel}
                htmlFor={`assessment-mode-${sectionIndex}-${itemIndex}`}
              >
                Assessment (single attempt)
              </label>
              <Tooltip
                label="For assessment, not practice. When the learner finishes the roleplay, their attempt is submitted and they can't retake it. If a minimum score is set and they don't reach it, the course stays paused there until a trainer reopens the attempt."
                align="top"
              >
                <button type="button" className="cursor-pointer inline-flex items-center">
                  <TooltipIcon />
                </button>
              </Tooltip>
            </span>
            <span className="text-xs text-typography-500">
              Learners get one attempt. Trainers can give it back from the learner&apos;s Scenario
              attempts panel in Analytics. Can&apos;t be changed once learners are enrolled.
            </span>
          </div>
          <Controller
            control={control}
            name={`${base}.assessmentMode`}
            render={({ field }) => (
              <ToggleSwitch
                id={`assessment-mode-${sectionIndex}-${itemIndex}`}
                enabled={field.value ?? false}
                onChange={field.onChange}
                disabled={disabled}
                label="Assessment (single attempt)"
              />
            )}
          />
        </div>
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

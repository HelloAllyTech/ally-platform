import { FC } from "react";

import { Controller, useFormContext } from "react-hook-form";

import { Select, SelectItem, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { ToggleSwitch } from "@components";
import { QUIZ_SHOW_EXPLANATIONS_OPTIONS } from "@constants";
import { useContentAuthoring } from "@hooks";
import { QuizShowExplanations, TrackFormValues } from "@types";

import { AttemptLimitField } from "../AttemptLimitField";

interface QuizSettingsFieldsProps {
  sectionIndex: number;
  itemIndex: number;
  /** The course is live: Max attempts can only go up, through its own endpoint. */
  isPublished?: boolean;
}

const rowClass = "flex items-center justify-between gap-4 py-2";
const labelClass = "text-sm text-typography-800";
const numberInput =
  "w-24 border border-border-light rounded-md px-2 py-1 text-sm outline-none focus:border-primary-400";

/** Quiz-level settings. `passScore` is authoritative here; the server mirrors it. */
export const QuizSettingsFields: FC<QuizSettingsFieldsProps> = ({
  sectionIndex,
  itemIndex,
  isPublished = false,
}) => {
  const {
    control,
    formState: { defaultValues },
  } = useFormContext<TrackFormValues>();
  const { canAuthorCourses } = useContentAuthoring();
  const base = `sections.${sectionIndex}.items.${itemIndex}.quiz.settings` as const;

  // What the server holds (the form's defaults are reset from it after every
  // load and save). Structure is locked on a live course, so index = item.
  const savedItem = defaultValues?.sections?.[sectionIndex]?.items?.[itemIndex];
  const isLive = isPublished && Boolean(savedItem?.serverId);

  return (
    <div className="flex flex-col divide-y divide-border-light">
      <div className={rowClass}>
        <span className="inline-flex items-center gap-1">
          <span className={labelClass}>Pass score (%)</span>
          <Tooltip
            label="Minimum percentage of points a learner needs to pass this quiz."
            align="top"
          >
            <button type="button" className="cursor-pointer inline-flex items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
        </span>
        <Controller
          control={control}
          name={`${base}.passScore`}
          render={({ field }) => (
            <input
              type="number"
              min={0}
              max={100}
              className={numberInput}
              value={field.value ?? ""}
              onChange={event =>
                field.onChange(event.target.value === "" ? undefined : Number(event.target.value))
              }
              onWheel={event => event.currentTarget.blur()}
            />
          )}
        />
      </div>

      <div className={rowClass}>
        <span className="inline-flex items-center gap-1">
          <span className={labelClass}>Max attempts</span>
          <Tooltip
            label={
              isLive
                ? "On a live course the limit can only go up, and applies to every enrolled learner."
                : "Checking Unlimited lets learners retake this quiz as many times as they want."
            }
            align="top"
          >
            <button type="button" className="cursor-pointer inline-flex items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
        </span>
        <Controller
          control={control}
          name={`${base}.maxAttempts`}
          render={({ field }) => (
            <AttemptLimitField
              value={field.value}
              onChange={field.onChange}
              savedValue={savedItem?.quiz?.settings?.maxAttempts}
              isLive={isLive}
              canEdit={canAuthorCourses}
            />
          )}
        />
      </div>

      <div className={rowClass}>
        <span className="inline-flex items-center gap-1">
          <span className={labelClass}>Shuffle questions</span>
          <Tooltip
            label="Randomizes the order questions appear in for each learner. Doesn't affect the order of answer options within a question — that's Shuffle options, below."
            align="top"
          >
            <button type="button" className="cursor-pointer inline-flex items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
        </span>
        <Controller
          control={control}
          name={`${base}.shuffleQuestions`}
          render={({ field }) => (
            <ToggleSwitch enabled={field.value ?? false} onChange={field.onChange} />
          )}
        />
      </div>

      <div className={rowClass}>
        <span className="inline-flex items-center gap-1">
          <span className={labelClass}>Shuffle options</span>
          <Tooltip
            label="Randomizes the order of answer options (e.g. multiple-choice, matching) within each question."
            align="top"
          >
            <button type="button" className="cursor-pointer inline-flex items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
        </span>
        <Controller
          control={control}
          name={`${base}.shuffleOptions`}
          render={({ field }) => (
            <ToggleSwitch enabled={field.value ?? false} onChange={field.onChange} />
          )}
        />
      </div>

      <div className={rowClass}>
        <span className="inline-flex items-center gap-1">
          <span className={labelClass}>Show explanations</span>
          <Tooltip
            label="Controls when learners see each question's explanation text: right after answering, only after submitting the whole quiz, or never."
            align="top"
          >
            <button type="button" className="cursor-pointer inline-flex items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
        </span>
        <Controller
          control={control}
          name={`${base}.showExplanations`}
          render={({ field }) => (
            <Select
              id={`${base}.showExplanations`}
              labelText="Show explanations"
              hideLabel
              value={field.value ?? "after_submit"}
              onChange={event => field.onChange(event.target.value as QuizShowExplanations)}
            >
              {QUIZ_SHOW_EXPLANATIONS_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value} text={option.label} />
              ))}
            </Select>
          )}
        />
      </div>
    </div>
  );
};

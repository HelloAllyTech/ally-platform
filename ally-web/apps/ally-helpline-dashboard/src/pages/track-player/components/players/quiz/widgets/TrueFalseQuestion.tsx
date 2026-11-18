import { FC } from "react";

import { useTranslation } from "react-i18next";

import { QuizAnswerState } from "../quizAnswerState";

interface TrueFalseQuestionProps {
  state: QuizAnswerState;
  onChange: (state: QuizAnswerState) => void;
  /**
   * The language the course is being read in (`TrackDetail.languageCode`).
   * The prompt arrives already translated into it, so the two answers must
   * follow it too — otherwise a Marathi question ending in "…बरोबर?" sat
   * above English "True / False" cards whenever the app UI was English.
   * Absent (older callers, previews), the app language is used.
   */
  languageCode?: string | null;
}

/** True/false question — two large tappable option cards. */
export const TrueFalseQuestion: FC<TrueFalseQuestionProps> = ({
  state,
  onChange,
  languageCode,
}) => {
  const { t } = useTranslation();
  // Every locale bundle is registered at init, so a `lng` override resolves
  // synchronously (and falls through to English for an unsupported code).
  const tOptions = languageCode ? { lng: languageCode } : undefined;

  const options: { value: boolean; label: string }[] = [
    { value: true, label: t("tracks2.quiz.question.true", tOptions) },
    { value: false, label: t("tracks2.quiz.question.false", tOptions) },
  ];

  return (
    <div className="flex gap-3" role="radiogroup">
      {options.map(option => {
        const isSelected = state.booleanAnswer === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange({ booleanAnswer: option.value })}
            className={`flex-1 rounded-[14px] border p-5 text-center text-lg font-medium transition-colors ${
              isSelected
                ? "border-primary-500 bg-primary-50 text-primary-700"
                : "border-border-light bg-white text-typography-900 hover:border-primary-300"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

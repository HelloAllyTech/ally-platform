import { FC, useState } from "react";

import { useTranslation } from "react-i18next";

import { useSubmitDebriefFeedbackMutation } from "@api";
import { ThumbDown, ThumbDownFilled, ThumbUp, ThumbUpFilled, SendArrow } from "@assets";

interface DebriefFeedbackProps {
  sessionId: string;
}

type FeedbackState = "initial" | "voted" | "thankyou";

export const DebriefFeedback: FC<DebriefFeedbackProps> = ({ sessionId }) => {
  const { t } = useTranslation();
  const [submitFeedback, { isLoading }] = useSubmitDebriefFeedbackMutation();
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<FeedbackState>("initial");

  const handleVote = async (vote: "positive" | "negative") => {
    setRating(vote);
    setState("voted");
    try {
      await submitFeedback({ sessionId, rating: vote }).unwrap();
    } catch {
      // Error is handled by the API slice or we could show a toast
    }
  };

  const handleSubmitComment = async () => {
    if (!rating) return;
    try {
      await submitFeedback({ sessionId, rating, comment }).unwrap();
      setState("thankyou");
    } catch {
      // Error handled
    }
  };

  if (state === "thankyou") {
    return (
      <div className="mt-4 flex flex-col gap-2 rounded-lg bg-primary-50 p-4">
        <p className="font-primary text-sm font-medium text-primary-900">
          {t("postSim.debrief.feedback.thankYou")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-gray-100 pt-4">
      <div className="flex items-center gap-4">
        <span className="font-primary text-sm font-medium text-typography-700">
          {state === "initial"
            ? t("postSim.debrief.feedback.question")
            : t("postSim.debrief.feedback.thankYou")}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => handleVote("positive")}
            disabled={state !== "initial" || isLoading}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              rating === "positive"
                ? "bg-primary-100 text-primary-600"
                : "text-typography-400 hover:bg-gray-100"
            }`}
            aria-label="Thumbs up"
          >
            {rating === "positive" ? (
              <ThumbUpFilled className="h-5 w-5" />
            ) : (
              <ThumbUp className="h-5 w-5" />
            )}
          </button>
          <button
            onClick={() => handleVote("negative")}
            disabled={state !== "initial" || isLoading}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              rating === "negative"
                ? "bg-red-100 text-red-600"
                : "text-typography-400 hover:bg-gray-100"
            }`}
            aria-label="Thumbs down"
          >
            {rating === "negative" ? (
              <ThumbDownFilled className="h-5 w-5" />
            ) : (
              <ThumbDown className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {state === "voted" && (
        <div className="flex flex-col gap-2">
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={t("postSim.debrief.feedback.commentPlaceholder")}
            className="w-full rounded-md border border-gray-200 p-3 font-primary text-sm text-typography-800 placeholder:text-typography-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            rows={3}
          />
          <div className="flex justify-end">
            <button
              onClick={handleSubmitComment}
              disabled={isLoading}
              className="flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 font-primary text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {t("common.submit")}
              <SendArrow className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

import { FC } from "react";

import { Loader2, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useDescriptionNarration } from "./useDescriptionNarration";

interface DescriptionNarrationButtonProps {
  /** Narration of the description; absent until it has been generated, and then nothing renders. */
  audioUrl?: string | null;
}

/** "Listen to description": play / pause for the role-play description narration. */
export const DescriptionNarrationButton: FC<DescriptionNarrationButtonProps> = ({ audioUrl }) => {
  const { t } = useTranslation();
  const { status, toggle } = useDescriptionNarration(audioUrl);
  if (!audioUrl) return null;

  const label =
    status === "playing"
      ? t("learn.scenario.narration.pause", "Pause")
      : status === "paused"
        ? t("learn.scenario.narration.resume", "Resume")
        : t("learn.scenario.narration.listen", "Listen to description");
  const Icon = status === "loading" ? Loader2 : status === "playing" ? Pause : Play;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        data-testid="description-narration-button"
        data-state={status}
        aria-label={label}
        onClick={toggle}
        disabled={status === "loading"}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-primary-500 px-3 font-primary text-sm text-primary-500 transition-colors hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 disabled:opacity-60"
      >
        <Icon
          aria-hidden="true"
          className={`h-4 w-4 ${status === "loading" ? "animate-spin" : ""}`}
        />
        {label}
      </button>
      {status === "error" && (
        <span role="alert" className="font-primary text-xs text-red-600">
          {t(
            "learn.scenario.narration.error",
            "Audio couldn't be played. You can still read the description.",
          )}
        </span>
      )}
    </div>
  );
};

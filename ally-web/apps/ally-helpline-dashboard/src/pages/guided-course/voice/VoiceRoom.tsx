import { FC } from "react";

import { useTranslation } from "react-i18next";

import { AllyPresence, OrbState } from "../presence/AllyPresence";

import type { GuideVoice } from "./useGuideVoice";

const MIC_GUIDANCE: Record<string, string> = {
  blocked: "simulationPage.microphoneBlockedMessage",
  notFound: "simulationPage.microphoneNotFoundMessage",
  inUse: "simulationPage.microphoneInUseMessage",
  unknown: "simulationPage.microphoneUnknownMessage",
};

const quiet =
  "min-h-9 rounded-lg border border-[var(--g-line)] bg-[var(--g-card)] px-3 font-primary text-sm text-[var(--g-ink)] max-md:min-h-11";

/**
 * The voice panel (presence spec §8): a band above the composer with the orb
 * carrying Ally's state, the live captions, and the learner's controls.
 * Typing stays available underneath the whole time.
 */
export const VoiceRoom: FC<{ voice: GuideVoice; compact: boolean }> = ({ voice, compact }) => {
  const { t } = useTranslation();
  const { state } = voice;

  if (state.phase === "failed") {
    const message =
      state.failure === "microphone"
        ? t(MIC_GUIDANCE[state.microphoneError?.kind ?? "unknown"])
        : state.failure === "disabled"
          ? t("guide.voice.disabled")
          : t("guide.voice.failed");
    return (
      <div
        className="flex flex-col gap-2 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-3 py-2"
        role="status"
        data-testid="voice-failed"
      >
        {state.failure === "microphone" && (
          <p className="font-primary text-sm font-semibold text-[var(--g-ink)]">
            {t("guide.voice.micTitle")}
          </p>
        )}
        <p className="font-secondary text-base text-[var(--g-ink)]">{message}</p>
        <div className="flex flex-wrap gap-2">
          {state.failure !== "disabled" && (
            <button type="button" className={quiet} onClick={() => void voice.start()}>
              {t("guide.common.retry")}
            </button>
          )}
          <button type="button" className={quiet} onClick={voice.clearFailure}>
            {t("guide.voice.typeInstead")}
          </button>
        </div>
      </div>
    );
  }

  if (!voice.active) return null;

  const orb: OrbState =
    state.agentState === "speaking"
      ? "speaking"
      : state.agentState === "thinking"
        ? "thinking"
        : state.learnerSpeaking || state.pushing
          ? "listening"
          : "idle";
  const status =
    state.phase === "connecting"
      ? t("guide.voice.connecting")
      : state.phase === "reconnecting"
        ? t("guide.voice.reconnecting")
        : orb === "speaking"
          ? t("guide.voice.speaking")
          : orb === "thinking"
            ? t("guide.voice.thinking")
            : state.turnMode === "push_to_talk" && !state.pushing
              ? t("guide.voice.holdHint")
              : t("guide.voice.listening");

  return (
    <section
      aria-label={t("guide.voice.label")}
      data-testid="voice-room"
      className="flex flex-col gap-3 rounded-2xl border border-[var(--g-ally-edge)] bg-[var(--g-ally-wash)] p-3"
    >
      <div className="flex items-center gap-3">
        <AllyPresence state={orb} size={compact ? 48 : 64} label={status} />
        <div className="min-w-0 flex-1">
          <p className="g-caption" aria-live="polite">
            {status}
          </p>
          {state.allyCaption && (
            <p
              className="mt-1 line-clamp-3 font-secondary text-base text-[var(--g-ink)]"
              data-testid="voice-ally-caption"
            >
              {state.allyCaption}
            </p>
          )}
          {state.learnerCaption && (state.learnerSpeaking || state.pushing) && (
            <p className="mt-1 line-clamp-2 font-secondary text-sm italic text-[var(--g-ink-soft)]">
              {state.learnerCaption}
            </p>
          )}
        </div>
      </div>

      {state.suggestPushToTalk && (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <p className="min-w-0 flex-1 font-primary text-sm text-[var(--g-ink)]">
            {t("guide.voice.suggestPtt")}
          </p>
          <button
            type="button"
            className={quiet}
            onClick={() => void voice.setTurnMode("push_to_talk")}
          >
            {t("guide.voice.usePtt")}
          </button>
          <button
            type="button"
            className="font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2"
            onClick={voice.dismissSuggestion}
          >
            {t("guide.voice.keepHandsFree")}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {state.turnMode === "push_to_talk" && (
          <button
            type="button"
            aria-pressed={state.pushing}
            onPointerDown={() => void voice.pressToTalk(true)}
            onPointerUp={() => void voice.pressToTalk(false)}
            onPointerLeave={() => state.pushing && void voice.pressToTalk(false)}
            onKeyDown={event => {
              if ((event.key === " " || event.key === "Enter") && !event.repeat)
                void voice.pressToTalk(true);
            }}
            onKeyUp={event => {
              if (event.key === " " || event.key === "Enter") void voice.pressToTalk(false);
            }}
            className="min-h-11 flex-1 rounded-[10px] bg-[var(--g-action)] px-4 font-primary text-[15px] font-semibold text-[var(--g-on-action)]"
          >
            {state.pushing ? t("guide.voice.release") : t("guide.voice.hold")}
          </button>
        )}
        <div
          className="flex rounded-lg border border-[var(--g-line)] bg-[var(--g-card)] p-0.5"
          role="group"
          aria-label={t("guide.voice.modeLabel")}
        >
          {(["hands_free", "push_to_talk"] as const).map(mode => (
            <button
              key={mode}
              type="button"
              aria-pressed={state.turnMode === mode}
              onClick={() => void voice.setTurnMode(mode)}
              className={`min-h-8 rounded-md px-2 font-primary text-xs max-md:min-h-11 ${
                state.turnMode === mode
                  ? "bg-[var(--g-learner-bubble)] font-semibold text-[var(--g-ink)]"
                  : "text-[var(--g-ink-soft)]"
              }`}
            >
              {t(mode === "hands_free" ? "guide.voice.handsFree" : "guide.voice.pushToTalk")}
            </button>
          ))}
        </div>
        <button type="button" className={`${quiet} ml-auto`} onClick={() => void voice.stop()}>
          {t("guide.voice.end")}
        </button>
      </div>
    </section>
  );
};

/** The composer's microphone: start talking, or resume after a roleplay. */
export const VoiceButton: FC<{ voice: GuideVoice; disabled?: boolean }> = ({ voice, disabled }) => {
  const { t } = useTranslation();
  if (voice.active) return null;
  return (
    <button
      type="button"
      onClick={() => void voice.start()}
      disabled={disabled}
      aria-label={voice.state.canResume ? t("guide.voice.resume") : t("guide.voice.start")}
      data-testid="voice-button"
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-2.5 font-primary text-sm text-[var(--g-ink)] disabled:opacity-40 max-md:h-11"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M8 2.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2zM4 7.5a4 4 0 0 0 8 0M8 11.5v2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      {voice.state.canResume && <span>{t("guide.voice.resume")}</span>}
    </button>
  );
};

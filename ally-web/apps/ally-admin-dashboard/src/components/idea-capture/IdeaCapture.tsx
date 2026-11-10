import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { useCreateRoadmapIdeaDraftMutation, useTranscribeRoadmapIdeaMutation } from "@api";
import { FeatureToggleKey, Permissions, ROUTES } from "@constants";
import { useUser } from "@hooks";
import { useSpeechCapture } from "@hooks/useSpeechCapture";
import { IDEA_DRAFT_TEXT_MAX } from "@types";
import { hasFeature } from "@utils";

import { MicBulbIcon } from "./MicBulbIcon";

const UNSENT_KEY = "ally-admin-idea-capture-unsent";
const REVEAL_MS = 650;

/** Best-effort: storage can throw (private window, blocked site data) and must never break capture. */
const readUnsent = (): string => {
  try {
    return localStorage.getItem(UNSENT_KEY) ?? "";
  } catch {
    return "";
  }
};
const writeUnsent = (value: string) => {
  try {
    if (value) localStorage.setItem(UNSENT_KEY, value);
    else localStorage.removeItem(UNSENT_KEY);
  } catch {
    // ignore
  }
};

const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

/** The file extension the backend's transcriber expects for a recorded clip. */
const clipExtension = (type: string) =>
  type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";

const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/**
 * The global "say your idea" door: a mic-and-bulb button pinned top-right of every admin screen,
 * which opens a full-screen capture surface that grows out of the button itself.
 *
 * WHAT IT IS FOR. Getting the raw first version of an idea out before it evaporates. It does NOT
 * file anything: Save puts a private draft in the author's "My drafts" tab on the Product
 * Roadmap, where it is later continued through the normal copilot interview (which is what
 * creates the real, readiness-checked opportunity).
 *
 * THE MIC STARTS ITSELF. Opening is the user gesture, so recording starts inside the click
 * handler — no second "start" tap between having the thought and saying it. Pause, Stop and the
 * keyboard remain: stopping the mic leaves the screen and the text exactly where they are.
 *
 * WORDS ARRIVE PHRASE BY PHRASE. Speech is recorded here and transcribed by the backend (see
 * useSpeechCapture for why not the browser's own recognition), so each phrase lands a moment
 * after the speaker pauses. Save waits for any phrase still being transcribed.
 *
 * Access mirrors filing an opportunity (the VOTE permission, the roadmap toggle and Product
 * Planning — Ideas), because the draft endpoints do; anyone else never sees the button.
 */
export const IdeaCaptureLauncher: React.FC = () => {
  const { permissions, features } = useUser();
  const allowed =
    !!permissions?.includes(Permissions.VOTE_PRODUCT_ROADMAP) &&
    hasFeature(features, FeatureToggleKey.PRODUCT_ROADMAP) &&
    // Parking an idea is filing's first step: Product Planning — Ideas, as ally-be checks.
    hasFeature(features, FeatureToggleKey.PRODUCT_PLANNING_IDEAS);

  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [mounted, setMounted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [text, setTextState] = useState("");
  /**
   * The text as of right now, ahead of the next render. Save reads this after waiting for the
   * last phrase: that phrase has been appended by then, but React may not have re-rendered.
   */
  const textRef = useRef("");
  const setText = useCallback((next: string) => {
    textRef.current = next;
    setTextState(next);
  }, []);
  /** Whether any of the text was dictated. A ref: Save reads it right after the last phrase lands. */
  const usedVoice = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [saved, setSaved] = useState(false);
  /** Save was pressed and is waiting for the last spoken words to be transcribed. */
  const [finishing, setFinishing] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const [createDraft, { isLoading: isSaving }] = useCreateRoadmapIdeaDraftMutation();
  const [transcribeClip] = useTranscribeRoadmapIdeaMutation();

  const transcribe = useCallback(
    async (clip: Blob) => {
      const body = new FormData();
      body.append("audio", clip, `idea.${clipExtension(clip.type)}`);
      return (await transcribeClip(body).unwrap()).text;
    },
    [transcribeClip],
  );

  const onTranscribeError = useCallback(() => {
    toast.error("Couldn't catch part of that. Say it again, or type it.");
  }, []);

  const appendFinal = useCallback(
    (phrase: string) => {
      if (!phrase) return;
      usedVoice.current = true;
      const current = textRef.current;
      const joined =
        current && !/\s$/.test(current) ? `${current} ${phrase}` : `${current}${phrase}`;
      setText(joined.slice(0, IDEA_DRAFT_TEXT_MAX));
    },
    [setText],
  );

  const speech = useSpeechCapture({
    onFinal: appendFinal,
    transcribe,
    onError: onTranscribeError,
  });
  const isListening = speech.status === "listening";

  // Elapsed listening time — counts only while the mic is actually hearing.
  useEffect(() => {
    if (!isListening) return undefined;
    const id = window.setInterval(() => setElapsed(value => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [isListening]);

  // Keep what has been said safe across an accidental refresh or closed tab.
  useEffect(() => {
    if (mounted && !saved) writeUnsent(text);
  }, [text, mounted, saved]);

  // Keep the newest words in view while dictating.
  useEffect(() => {
    const el = textareaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, speech.transcribing]);

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    setOrigin(
      rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth - 40, y: 24 },
    );
    setText(readUnsent());
    usedVoice.current = false;
    setElapsed(0);
    setSaved(false);
    setFinishing(false);
    setConfirmingClose(false);
    setMounted(true);
    // Inside the click, so the mic opens as part of the user's gesture.
    speech.start();
    requestAnimationFrame(() => requestAnimationFrame(() => setRevealed(true)));
  };

  const finishClose = useCallback(() => {
    // Anything still being transcribed was either saved already or is being discarded.
    speech.cancel();
    setRevealed(false);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setMounted(false), REVEAL_MS);
  }, [speech]);

  const requestClose = useCallback(() => {
    if (saved || (!text.trim() && !speech.transcribing)) {
      if (!saved) writeUnsent("");
      finishClose();
      return;
    }
    speech.pause();
    setConfirmingClose(true);
  }, [saved, text, speech, finishClose]);

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const save = useCallback(async () => {
    if (isSaving || finishing) return;
    // The last phrase may still be on its way: stop the mic, then wait for it before reading.
    speech.stop();
    setFinishing(true);
    await speech.finish();
    setFinishing(false);
    const rawText = textRef.current.trim();
    if (!rawText) {
      toast.error("No words were caught. Try the mic again, or type your idea.");
      return;
    }
    try {
      await createDraft({ rawText, captureMode: usedVoice.current ? "voice" : "typed" }).unwrap();
      writeUnsent("");
      setConfirmingClose(false);
      setSaved(true);
      window.setTimeout(() => {
        finishClose();
        toast.success("Idea saved to My drafts", {
          description: "It's private and unpublished. Pick it up whenever you're ready.",
          action: {
            label: "Open drafts",
            onClick: () => navigate(`${ROUTES.PRODUCT_ROADMAP}?tab=drafts`),
          },
        });
      }, 1100);
    } catch (error) {
      const message = (error as { data?: { message?: string | string[] } })?.data?.message;
      toast.error(
        (Array.isArray(message) ? message[0] : message) ||
          "Could not save that idea. Your words are still here — try again.",
      );
    }
  }, [isSaving, finishing, speech, createDraft, finishClose, navigate]);

  // Keyboard: Esc closes (safely), Cmd/Ctrl+Enter saves.
  useEffect(() => {
    if (!mounted) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmingClose) setConfirmingClose(false);
        else requestClose();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void save();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mounted, confirmingClose, requestClose, save]);

  const radius = useMemo(() => {
    if (typeof window === "undefined") return 2000;
    const dx = Math.max(origin.x, window.innerWidth - origin.x);
    const dy = Math.max(origin.y, window.innerHeight - origin.y);
    return Math.ceil(Math.hypot(dx, dy)) + 40;
  }, [origin]);

  if (!allowed) return null;

  const status = speech.status;
  const headline =
    status === "listening"
      ? "Listening…"
      : status === "paused"
        ? "Paused"
        : status === "denied"
          ? "Microphone is blocked"
          : status === "unavailable"
            ? "Can't reach the microphone"
            : status === "unsupported"
              ? "Voice isn't available in this browser"
              : text.trim()
                ? "Mic is off"
                : "Ready when you are";
  const subline =
    status === "listening"
      ? "Capturing the absolute first, raw version of your idea. No structure needed — just talk."
      : status === "paused"
        ? "Take your time. Resume when the next thought arrives."
        : status === "denied"
          ? "Allow the microphone from your browser's address bar, or just type your idea below."
          : status === "unavailable"
            ? "No microphone was found, or it couldn't be opened. Tap the mic to retry, or type below."
            : status === "unsupported"
              ? "Type your idea below — it saves exactly the same."
              : "Tap the mic to talk again, or keep typing.";

  const canMic = status !== "unsupported" && status !== "denied";
  const orbScale = 1 + (isListening ? speech.level * 0.45 : 0);
  const hasText = text.trim().length > 0;
  /** Words may be on their way even before any are on screen. */
  const canSave = (hasText || isListening || speech.transcribing) && !isSaving && !finishing;

  const overlay = mounted
    ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Record an idea"
          className="idea-capture-surface fixed inset-0 z-[60] overflow-hidden text-white"
          style={{
            clipPath: `circle(${revealed ? radius : 0}px at ${origin.x}px ${origin.y}px)`,
            transition: `clip-path ${REVEAL_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
            background:
              "radial-gradient(120% 90% at 80% 0%, #2b2377 0%, #120f33 45%, #07061a 100%)",
          }}
        >
          <div className="idea-aurora idea-aurora-a" aria-hidden="true" />
          <div className="idea-aurora idea-aurora-b" aria-hidden="true" />

          <div
            className="relative mx-auto flex h-full w-full max-w-3xl flex-col px-5 pb-6 pt-4 md:px-8 md:pb-8"
            style={{
              opacity: revealed ? 1 : 0,
              transform: revealed ? "none" : "translateY(14px)",
              transition: `opacity 420ms ease ${revealed ? 260 : 0}ms, transform 520ms cubic-bezier(0.22,1,0.36,1) ${revealed ? 260 : 0}ms`,
            }}
          >
            {/* top bar */}
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.18em] text-white/50">New idea</span>
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close idea capture"
                className="-mr-2 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* orb + status */}
            <div className="flex flex-col items-center pt-2 md:pt-6">
              <div className="relative flex h-40 w-40 items-center justify-center md:h-48 md:w-48">
                {isListening && (
                  <>
                    <span className="idea-ripple" />
                    <span className="idea-ripple idea-ripple-2" />
                    <span className="idea-ripple idea-ripple-3" />
                  </>
                )}
                <button
                  type="button"
                  onClick={() =>
                    isListening ? speech.pause() : canMic ? speech.start() : undefined
                  }
                  disabled={!canMic}
                  aria-label={
                    isListening
                      ? "Pause recording"
                      : status === "paused"
                        ? "Resume recording"
                        : "Start recording"
                  }
                  className={`relative flex h-24 w-24 cursor-pointer items-center justify-center rounded-full transition-[filter,opacity] duration-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-not-allowed md:h-28 md:w-28 ${
                    isListening ? "" : "opacity-70 saturate-50"
                  } ${status === "paused" ? "idea-breathe" : ""}`}
                  style={{
                    transform: `scale(${orbScale})`,
                    transition: "transform 90ms linear, filter 500ms, opacity 500ms",
                    background:
                      "radial-gradient(circle at 30% 25%, #c7b8ff 0%, #7c5cff 45%, #3a22b8 100%)",
                    boxShadow: isListening
                      ? `0 0 ${40 + speech.level * 80}px ${8 + speech.level * 24}px rgba(124,92,255,0.45)`
                      : "0 0 30px 4px rgba(124,92,255,0.25)",
                  }}
                >
                  {isListening ? (
                    <svg
                      width="34"
                      height="34"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <rect x="6.5" y="5" width="3.6" height="14" rx="1.4" />
                      <rect x="13.9" y="5" width="3.6" height="14" rx="1.4" />
                    </svg>
                  ) : (
                    <MicBulbIcon size={38} />
                  )}
                </button>
              </div>

              <h2
                className="mt-3 text-2xl font-light tracking-tight md:text-3xl"
                aria-live="polite"
              >
                {headline}
              </h2>
              <p className="mt-1 max-w-md text-center text-sm text-white/60">{subline}</p>
              <div className="mt-2 flex items-center gap-3 text-xs tabular-nums text-white/40">
                <span>{formatClock(elapsed)}</span>
                <span aria-hidden="true">·</span>
                <span>{wordCount(text)} words</span>
              </div>
            </div>

            {/* the words */}
            <div className="relative mt-4 flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm md:p-5">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={event => setText(event.target.value.slice(0, IDEA_DRAFT_TEXT_MAX))}
                placeholder="Your idea appears here as you speak. You can edit it, or just type."
                aria-label="Your idea"
                className="min-h-0 w-full flex-1 resize-none bg-transparent text-lg leading-relaxed text-white outline-none placeholder:text-white/30 md:text-xl"
              />
              {(speech.transcribing || finishing) && (
                <p className="mt-2 text-base italic text-white/45" aria-live="polite">
                  Writing down what you said…
                </p>
              )}
              <span className="absolute bottom-2 right-4 text-[11px] tabular-nums text-white/25">
                {text.length}/{IDEA_DRAFT_TEXT_MAX}
              </span>
            </div>

            {/* controls */}
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={speech.stop}
                  disabled={status !== "listening" && status !== "paused"}
                  className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-white/15 px-4 text-sm text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                >
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-current" aria-hidden="true" />
                  Stop mic
                </button>
                {canMic && status === "idle" && (
                  <button
                    type="button"
                    onClick={speech.start}
                    className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-white/15 px-4 text-sm text-white/80 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <MicBulbIcon size={16} /> Talk again
                  </button>
                )}
                {status === "paused" && (
                  <button
                    type="button"
                    onClick={speech.resume}
                    className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-white/15 px-4 text-sm text-white/80 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  >
                    Resume
                  </button>
                )}
              </div>

              <Tooltip label="Saves privately to My drafts. Nothing is published." align="top">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={!canSave}
                  className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-white px-6 text-sm font-medium text-[#1a1250] shadow-lg shadow-black/30 transition hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {finishing ? "Finishing…" : isSaving ? "Saving…" : "Save to drafts"}
                  <kbd className="hidden rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-normal md:inline">
                    ⌘↵
                  </kbd>
                </button>
              </Tooltip>
            </div>

            {/* leave-with-words confirmation */}
            {confirmingClose && (
              <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm md:items-center">
                <div className="w-full max-w-sm rounded-2xl bg-[#1a1650] p-5 shadow-2xl ring-1 ring-white/10">
                  <h3 className="text-lg">Keep this idea?</h3>
                  <p className="mt-1 text-sm text-white/60">
                    You've said {wordCount(text)} words. Save them so they don't evaporate.
                  </p>
                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={isSaving || finishing}
                      className="h-11 cursor-pointer rounded-full bg-white text-sm font-medium text-[#1a1250] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {finishing ? "Finishing…" : isSaving ? "Saving…" : "Save to drafts"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingClose(false)}
                      className="h-11 cursor-pointer rounded-full border border-white/15 text-sm text-white/80 hover:bg-white/10"
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        writeUnsent("");
                        setConfirmingClose(false);
                        finishClose();
                      }}
                      className="h-11 cursor-pointer rounded-full text-sm text-white/50 hover:text-white"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* saved */}
            {saved && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#07061a]/85 backdrop-blur-md">
                <svg width="88" height="88" viewBox="0 0 52 52" fill="none" aria-hidden="true">
                  <circle
                    cx="26"
                    cy="26"
                    r="24"
                    stroke="#8b7bff"
                    strokeWidth="2"
                    className="idea-check-ring"
                  />
                  <path
                    d="M15 27l8 8 14-16"
                    stroke="#fff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="idea-check-tick"
                  />
                </svg>
                <p className="mt-4 text-xl font-light">Saved to your drafts</p>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <Tooltip label="Say an idea" align="bottom">
        <button
          ref={buttonRef}
          type="button"
          onClick={open}
          aria-label="Record a new idea by voice"
          data-testid="idea-capture-button"
          className="text-typography-secondary hover:text-primary-500 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        >
          <MicBulbIcon size={22} />
        </button>
      </Tooltip>
      {overlay}
    </>
  );
};

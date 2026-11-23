import { useCallback, useEffect, useRef, useState } from "react";

import { useRoadmapDictateMutation } from "../../../api/roadmapV2Flow";

/**
 * Dictation (D9, §4.2): one press starts it, one press stops it. The clip goes to
 * `POST /v1/roadmap/dictation` and the words come back as text for the caller to put in the box,
 * editable, never sent on their own. Esc cancels. It stops by itself at 2 minutes.
 *
 * One clip per press, deliberately simpler than idea capture's phrase-by-phrase `useSpeechCapture`:
 * the words land when you stop, which is what the plan's "on stop, the words type in" describes.
 */
export type DictationState =
  | "idle"
  | "starting"
  | "recording"
  | "transcribing"
  | "blocked"
  | "unavailable"
  | "failed"
  | "capReached"
  | "nothingHeard";

export const DICTATION_MAX_MS = 120_000;
/** Five bars, like the plan's sketch. */
export const LEVEL_BARS = 5;
const TICK_MS = 80;

const RECORDING_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const pickType = (): string | undefined => {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return RECORDING_TYPES.find(type => MediaRecorder.isTypeSupported(type));
};

export const canDictate = (): boolean =>
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

/** "0:07", "1:59". */
export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Filename extension from the real MIME type: the transcriber infers the container from it. */
export const extensionFor = (mime: string): string => {
  const base = mime.split(";")[0].trim();
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/mpeg") return "mp3";
  return "webm";
};

/** Map a dictation failure to the state the pill shows. */
export const dictationErrorState = (error: unknown): DictationState => {
  const data = (error as { data?: { code?: string } })?.data;
  const status = (error as { status?: unknown })?.status;
  if (data?.code === "idea_cap_reached" || data?.code === "plan_ceiling_reached")
    return "capReached";
  if (status === 409) return "capReached";
  return "failed";
};

interface Options {
  /** The draft or idea the mic is on; its spend is charged there. */
  code?: string;
  onText: (text: string) => void;
}

export const useDictation = ({ code, onText }: Options) => {
  const [dictate] = useRoadmapDictateMutation();
  const [state, setState] = useState<DictationState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BARS).fill(0));
  const stateRef = useRef<DictationState>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const set = (next: DictationState) => {
    stateRef.current = next;
    setState(next);
  };

  const release = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    setLevels(Array(LEVEL_BARS).fill(0));
  }, []);

  const send = useCallback(
    async (blob: Blob, durationMs: number) => {
      set("transcribing");
      const form = new FormData();
      form.append("audio", blob, `dictation.${extensionFor(blob.type || "audio/webm")}`);
      form.append(
        "durationMs",
        String(Math.max(1, Math.min(DICTATION_MAX_MS, Math.round(durationMs)))),
      );
      if (code) form.append("code", code);
      try {
        const result = await dictate(form).unwrap();
        const text = (result?.text ?? "").trim();
        if (!text) {
          set("nothingHeard");
          return;
        }
        set("idle");
        onTextRef.current(text);
      } catch (error) {
        set(dictationErrorState(error));
      }
    },
    [code, dictate],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || stateRef.current !== "recording") return;
    recorderRef.current = null;
    const durationMs = Date.now() - startedAtRef.current;
    recorder.onstop = () => {
      const type = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (cancelledRef.current) return;
      if (blob.size === 0) {
        set("nothingHeard");
        return;
      }
      void send(blob, durationMs);
    };
    try {
      recorder.stop();
    } catch {
      set("failed");
    }
    release();
  }, [release, send]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    try {
      recorder?.stop();
    } catch {
      // already stopped
    }
    release();
    set("idle");
  }, [release]);

  const start = useCallback(() => {
    if (stateRef.current === "recording" || stateRef.current === "starting") return;
    if (stateRef.current === "transcribing") return;
    if (!canDictate()) {
      set("unavailable");
      return;
    }
    cancelledRef.current = false;
    set("starting");
    navigator.mediaDevices
      .getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      .then(stream => {
        if (stateRef.current !== "starting") {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        try {
          const type = pickType();
          const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
          chunksRef.current = [];
          recorder.ondataavailable = event => {
            if (event.data.size > 0) chunksRef.current.push(event.data);
          };
          recorder.start();
          recorderRef.current = recorder;
        } catch {
          release();
          set("unavailable");
          return;
        }
        startedAtRef.current = Date.now();
        setElapsedMs(0);
        set("recording");

        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        let analyser: AnalyserNode | null = null;
        let data: Uint8Array | null = null;
        if (Ctx) {
          try {
            const ctx = new Ctx();
            ctxRef.current = ctx;
            analyser = ctx.createAnalyser();
            analyser.fftSize = 64;
            ctx.createMediaStreamSource(stream).connect(analyser);
            data = new Uint8Array(analyser.frequencyBinCount);
          } catch {
            analyser = null;
          }
        }
        timerRef.current = window.setInterval(() => {
          const elapsed = Date.now() - startedAtRef.current;
          setElapsedMs(elapsed);
          if (analyser && data) {
            analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
            const band = Math.max(1, Math.floor(data.length / LEVEL_BARS));
            const next: number[] = [];
            for (let bar = 0; bar < LEVEL_BARS; bar += 1) {
              let sum = 0;
              for (let i = bar * band; i < (bar + 1) * band && i < data.length; i += 1)
                sum += data[i];
              next.push(Math.min(1, (sum / band / 255) * 2.5));
            }
            setLevels(next);
          }
          if (elapsed >= DICTATION_MAX_MS) stop();
        }, TICK_MS);
      })
      .catch((error: unknown) => {
        if (stateRef.current !== "starting") return;
        const name = (error as { name?: string })?.name;
        set(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "unavailable");
      });
  }, [release, stop]);

  const toggle = useCallback(() => {
    if (stateRef.current === "recording") stop();
    else start();
  }, [start, stop]);

  // Esc cancels while recording (and only then).
  useEffect(() => {
    if (state !== "recording") return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [state, cancel]);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      try {
        recorderRef.current?.stop();
      } catch {
        // gone
      }
      release();
    },
    [release],
  );

  const dismiss = useCallback(() => {
    if (stateRef.current !== "recording" && stateRef.current !== "transcribing") set("idle");
  }, []);

  return { state, elapsedMs, levels, start, stop, cancel, toggle, dismiss };
};

/**
 * Insert dictated words into a box so they "type in quickly (≤ 300 ms in total)" (§4.18); at once
 * under reduced motion. Returns a cancel function.
 */
export const typeInText = (
  base: string,
  addition: string,
  apply: (value: string) => void,
  reduced: boolean,
): (() => void) => {
  const joiner = base && !/\s$/.test(base) ? " " : "";
  const full = `${base}${joiner}${addition}`;
  if (reduced || addition.length < 8 || typeof window === "undefined") {
    apply(full);
    return () => undefined;
  }
  const steps = 6;
  let step = 0;
  const id = window.setInterval(() => {
    step += 1;
    const upTo = step >= steps ? addition.length : Math.ceil((addition.length * step) / steps);
    apply(`${base}${joiner}${addition.slice(0, upTo)}`);
    if (step >= steps) window.clearInterval(id);
  }, 300 / steps);
  return () => {
    window.clearInterval(id);
    apply(full);
  };
};

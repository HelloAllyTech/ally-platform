import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal structural types for the Web Speech API — it is not in lib.dom for every TS version,
 * and only the bits used here are described.
 */
interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
}
interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => RecognitionLike;

const getCtor = (): RecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export type SpeechStatus =
  /** Mic off. The screen stays; typing still works and the mic can be started again. */
  | "idle"
  | "listening"
  | "paused"
  /** The browser has no speech recognition. Typing only. */
  | "unsupported"
  /** The user (or policy) refused the mic. Typing only until they allow it. */
  | "denied"
  /** No mic found, or the browser's speech service can't be reached. Typing only; can retry. */
  | "unavailable";

interface UseSpeechCaptureOptions {
  /** Called with each FINAL phrase, ready to append to the text. */
  onFinal: (text: string) => void;
  lang?: string;
}

/**
 * Browser speech-to-text with pause/resume/stop and a live 0..1 mic level for the orb.
 *
 * Chrome ends a "continuous" recognition after a stretch of silence, so while the status is
 * `listening` an unexpected `end` restarts it — otherwise a thinker who pauses to gather their
 * thoughts would silently stop being heard. `paused` and `idle` are deliberate and never restart.
 *
 * The level meter uses its own getUserMedia stream. It is best-effort: if it fails, recognition
 * still works and the orb simply breathes without reacting.
 */
export const useSpeechCapture = ({ onFinal, lang = "en-US" }: UseSpeechCaptureOptions) => {
  const supported = getCtor() !== null;
  const [status, setStatus] = useState<SpeechStatus>(supported ? "idle" : "unsupported");
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);

  const statusRef = useRef<SpeechStatus>(status);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const setBoth = (next: SpeechStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const startMeter = useCallback(async () => {
    try {
      if (streamRef.current || !navigator.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stopped while the permission prompt was open.
      if (statusRef.current !== "listening") {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        const avg = sum / data.length / 255;
        // Ease and boost so ordinary speech visibly moves the orb.
        setLevel(prev => prev * 0.6 + Math.min(1, avg * 3.2) * 0.4);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Best-effort only; see the hook comment.
    }
  }, []);

  const build = useCallback((): RecognitionLike | null => {
    const Ctor = getCtor();
    if (!Ctor) return null;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.onresult = event => {
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) onFinalRef.current(text.trim());
        else partial += text;
      }
      setInterim(partial);
    };
    recognition.onerror = event => {
      if (recognitionRef.current !== recognition) return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setBoth("denied");
        stopMeter();
      } else if (
        event.error === "audio-capture" ||
        event.error === "network" ||
        event.error === "language-not-supported"
      ) {
        // No mic, or the browser's speech service is unreachable. Restarting would loop forever
        // while the screen claims to be listening, so stop and say so.
        setBoth("unavailable");
        stopMeter();
      }
      // "no-speech" and "aborted" are normal; onend decides about restarting.
    };
    recognition.onend = () => {
      // A replaced instance must never restart itself over the new one.
      if (recognitionRef.current !== recognition) return;
      setInterim("");
      if (statusRef.current === "listening") {
        try {
          recognition.start();
        } catch {
          setBoth("idle");
          stopMeter();
        }
      }
    };
    return recognition;
  }, [lang, stopMeter]);

  const start = useCallback(() => {
    if (statusRef.current === "unsupported") return;
    const previous = recognitionRef.current;
    recognitionRef.current = null; // detaches the old instance's handlers (see build)
    previous?.abort();
    const recognition = build();
    if (!recognition) return;
    recognitionRef.current = recognition;
    setBoth("listening");
    try {
      recognition.start();
      void startMeter();
    } catch {
      setBoth("idle");
    }
  }, [build, startMeter]);

  const pause = useCallback(() => {
    if (statusRef.current !== "listening") return;
    setBoth("paused");
    recognitionRef.current?.stop();
    stopMeter();
  }, [stopMeter]);

  const stop = useCallback(() => {
    if (statusRef.current === "unsupported" || statusRef.current === "denied") return;
    setBoth("idle");
    recognitionRef.current?.stop();
    stopMeter();
    setInterim("");
  }, [stopMeter]);

  useEffect(
    () => () => {
      statusRef.current = "idle";
      recognitionRef.current?.abort();
      stopMeter();
    },
    [stopMeter],
  );

  return { status, interim, level, start, pause, resume: start, stop, supported };
};

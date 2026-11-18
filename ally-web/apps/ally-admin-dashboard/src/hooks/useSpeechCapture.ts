import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechStatus =
  /** Mic off. The screen stays; typing still works and the mic can be started again. */
  | "idle"
  | "listening"
  | "paused"
  /** The browser cannot record audio. Typing only. */
  | "unsupported"
  /** The user (or policy) refused the mic. Typing only until they allow it. */
  | "denied"
  /** No mic found, or it could not be opened. Typing only; can retry. */
  | "unavailable";

interface UseSpeechCaptureOptions {
  /** Called with each transcribed phrase, in the order it was spoken. */
  onFinal: (text: string) => void;
  /** Turns one recorded clip into text ('' when nothing intelligible was said). */
  transcribe: (clip: Blob) => Promise<string>;
  /** A clip could not be transcribed. Its words are lost; later ones still arrive. */
  onError?: () => void;
}

/** How often the mic level is read, and the clip boundaries checked. */
const TICK_MS = 50;
/** A clip ends once the speaker has been quiet this long... */
const PAUSE_MS = 900;
/** ...and has been recording at least this long, so a breath doesn't split a sentence... */
const MIN_CLIP_MS = 1500;
/** ...or after this long of unbroken speech, so words keep arriving during a monologue. */
const MAX_CLIP_MS = 30_000;
/** The lowest level that counts as speech, whatever the room's noise floor. */
const MIN_SPEECH_LEVEL = 0.02;

const RECORDING_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const pickRecordingType = (): string | undefined => {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return RECORDING_TYPES.find(type => MediaRecorder.isTypeSupported(type));
};

const canRecord = () =>
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

interface Clip {
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
  lastVoiceAt: number;
  heardSpeech: boolean;
}

/**
 * Speech-to-text for the idea-capture screen, with pause/resume/stop and a live 0..1 mic level.
 *
 * WHY NOT THE BROWSER'S SPEECH RECOGNITION. That is what this hook used first (Chrome's Web Speech
 * API). In production Chrome it sat on "Listening…" and never produced a word, without raising
 * an error: it listens on the operating system's default input rather than the microphone the
 * site was granted, and it depends on a Google service we cannot see into. So this records from
 * the microphone the browser actually gave us, the same way the LiveKit previews do.
 *
 * HOW. The mic is recorded in clips. A clip ends at a natural pause (or after 30 s of unbroken
 * speech), is sent to the backend for transcription, and a new clip starts at once, so words
 * appear phrase by phrase as the speaker pauses. Clips are transcribed concurrently but handed to
 * `onFinal` strictly in the order they were spoken. A clip with no speech in it is never sent:
 * transcription models invent words for silence.
 *
 * `finish()` resolves once every clip already recorded has been transcribed; call it after
 * `stop()` before reading the final text. `cancel()` stops and drops whatever is still in flight.
 */
export const useSpeechCapture = ({ onFinal, transcribe, onError }: UseSpeechCaptureOptions) => {
  const supported = canRecord();
  const [status, setStatus] = useState<SpeechStatus>(supported ? "idle" : "unsupported");
  const [level, setLevel] = useState(0);
  const [pendingClips, setPendingClips] = useState(0);

  const statusRef = useRef<SpeechStatus>(status);
  const callbacks = useRef({ onFinal, transcribe, onError });
  useEffect(() => {
    callbacks.current = { onFinal, transcribe, onError };
  }, [onFinal, transcribe, onError]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const clipRef = useRef<Clip | null>(null);
  const noiseFloorRef = useRef(0.01);
  /** Bumped by cancel(): results from an older generation are dropped. */
  const generationRef = useRef(0);
  const nextSeqRef = useRef(0);
  const nextToEmitRef = useRef(0);
  const resultsRef = useRef(new Map<number, string | null>());
  const inFlightRef = useRef(new Set<Promise<void>>());

  const setBoth = (next: SpeechStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const track = (work: Promise<void>) => {
    inFlightRef.current.add(work);
    void work.finally(() => inFlightRef.current.delete(work));
  };

  /** Hand finished transcripts to onFinal in spoken order, waiting on any earlier gap. */
  const drain = useCallback(() => {
    const results = resultsRef.current;
    while (results.has(nextToEmitRef.current)) {
      const text = results.get(nextToEmitRef.current);
      results.delete(nextToEmitRef.current);
      nextToEmitRef.current += 1;
      if (text) callbacks.current.onFinal(text);
    }
  }, []);

  const send = useCallback(
    (blob: Blob, generation: number) => {
      // Recorded before a cancel(): never sent, and never given a place in the order.
      if (generation !== generationRef.current) return;
      const seq = nextSeqRef.current;
      nextSeqRef.current += 1;
      setPendingClips(count => count + 1);
      const work = callbacks.current
        .transcribe(blob)
        .then(
          text => text.trim(),
          () => {
            if (generation === generationRef.current) callbacks.current.onError?.();
            return null;
          },
        )
        .then(text => {
          if (generation !== generationRef.current) return;
          resultsRef.current.set(seq, text);
          drain();
        })
        .finally(() => setPendingClips(count => Math.max(0, count - 1)));
      track(work);
    },
    [drain],
  );

  /** Ends the current clip; it is transcribed if anything was said in it. */
  const endClip = useCallback(() => {
    const clip = clipRef.current;
    clipRef.current = null;
    if (!clip || clip.recorder.state === "inactive") return;
    const generation = generationRef.current;
    track(
      new Promise<void>(resolve => {
        // A recorder that never reports `stop` must not leave Save waiting forever.
        const giveUp = window.setTimeout(resolve, 3000);
        clip.recorder.onstop = () => {
          window.clearTimeout(giveUp);
          const type = clip.recorder.mimeType || clip.chunks[0]?.type || "audio/webm";
          const blob = new Blob(clip.chunks, { type });
          if (clip.heardSpeech && blob.size > 0) send(blob, generation);
          resolve();
        };
        try {
          clip.recorder.stop();
        } catch {
          resolve();
        }
      }),
    );
  }, [send]);

  const beginClip = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return false;
    try {
      const type = pickRecordingType();
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const now = Date.now();
      const clip: Clip = {
        recorder,
        chunks: [],
        startedAt: now,
        lastVoiceAt: now,
        heardSpeech: false,
      };
      recorder.ondataavailable = event => {
        if (event.data.size > 0) clip.chunks.push(event.data);
      };
      recorder.start();
      clipRef.current = clip;
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Ends the clip and lets go of the mic (the browser's recording indicator goes off). */
  const release = useCallback(() => {
    endClip();
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setLevel(0);
  }, [endClip]);

  const startListening = useCallback(
    (stream: MediaStream) => {
      streamRef.current = stream;
      if (!beginClip()) {
        release();
        setBoth("unavailable");
        return;
      }
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        // No level meter means no pause detection: one clip per Pause/Stop, still transcribed.
        const clip = clipRef.current;
        if (clip) clip.heardSpeech = true;
        return;
      }
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      timerRef.current = window.setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        const raw = sum / data.length / 255;
        // Ease and boost so ordinary speech visibly moves the orb.
        setLevel(prev => prev * 0.5 + Math.min(1, raw * 3.2) * 0.5);

        const clip = clipRef.current;
        if (!clip || statusRef.current !== "listening") return;
        const now = Date.now();
        const threshold = Math.max(MIN_SPEECH_LEVEL, noiseFloorRef.current * 2.5);
        if (raw > threshold) {
          clip.heardSpeech = true;
          clip.lastVoiceAt = now;
        } else {
          // Track the room's own hum so a noisy fan doesn't count as talking forever.
          noiseFloorRef.current = noiseFloorRef.current * 0.97 + raw * 0.03;
        }
        const age = now - clip.startedAt;
        const pausedLongEnough = clip.heardSpeech && now - clip.lastVoiceAt >= PAUSE_MS;
        if ((pausedLongEnough && age >= MIN_CLIP_MS) || age >= MAX_CLIP_MS) {
          endClip();
          beginClip();
        }
      }, TICK_MS);
    },
    [beginClip, endClip, release],
  );

  const start = useCallback(() => {
    if (statusRef.current === "unsupported" || statusRef.current === "listening") return;
    setBoth("listening");
    if (streamRef.current) {
      if (!clipRef.current) beginClip();
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      .then(stream => {
        // Paused or stopped while the permission prompt was open.
        if (statusRef.current !== "listening") {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        startListening(stream);
      })
      .catch((error: unknown) => {
        if (statusRef.current !== "listening") return;
        const name = (error as { name?: string })?.name;
        setBoth(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      });
  }, [beginClip, startListening]);

  const pause = useCallback(() => {
    if (statusRef.current !== "listening") return;
    setBoth("paused");
    release();
  }, [release]);

  const stop = useCallback(() => {
    if (statusRef.current === "unsupported") return;
    if (statusRef.current !== "denied") setBoth("idle");
    release();
  }, [release]);

  /** Resolves once every clip recorded so far has been transcribed and handed to onFinal. */
  const finish = useCallback(async () => {
    while (inFlightRef.current.size > 0) {
      await Promise.allSettled([...inFlightRef.current]);
    }
  }, []);

  /** Stops and throws away anything not yet transcribed. */
  const cancel = useCallback(() => {
    stop(); // ends the current clip under the old generation...
    generationRef.current += 1; // ...which this then disowns
    resultsRef.current.clear();
    nextToEmitRef.current = nextSeqRef.current;
  }, [stop]);

  useEffect(
    () => () => {
      statusRef.current = "idle";
      release();
      generationRef.current += 1;
    },
    [release],
  );

  return {
    status,
    level,
    /** True while recorded words are still being turned into text. */
    transcribing: pendingClips > 0,
    start,
    pause,
    resume: start,
    stop,
    finish,
    cancel,
    supported,
  };
};

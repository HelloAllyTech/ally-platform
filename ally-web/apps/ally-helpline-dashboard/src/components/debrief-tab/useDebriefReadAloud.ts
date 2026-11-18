import { useCallback, useEffect, useRef, useState } from "react";

import { useLazyGetDebriefCardAudioQuery } from "@api";

export const READ_ALOUD_SPEEDS = [0.75, 1, 1.25] as const;
export type ReadAloudSpeed = (typeof READ_ALOUD_SPEEDS)[number];

export type ReadAloudStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface ReadAloud {
  status: ReadAloudStatus;
  /** The card being read, as a section path ("work_on_this[0]"). */
  current: string | null;
  speed: ReadAloudSpeed;
  /** Read these cards in order ("Listen all"), or one card. */
  play: (sections: string[]) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setSpeed: (speed: ReadAloudSpeed) => void;
}

/**
 * Read-aloud (v9 FR-29) for one debrief: fetches each card's audio on the
 * first tap (the server caches it), plays the queue in order and keeps the
 * current card so the page can highlight it. Audio is never the only way to
 * the content: an error stops playback and the cards stay readable.
 */
export const useDebriefReadAloud = (sessionId: string): ReadAloud => {
  const [fetchAudio] = useLazyGetDebriefCardAudioQuery();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const [status, setStatus] = useState<ReadAloudStatus>("idle");
  const [current, setCurrent] = useState<string | null>(null);
  const [speed, setSpeedState] = useState<ReadAloudSpeed>(1);
  const speedRef = useRef<ReadAloudSpeed>(1);
  // Bumped by every play and stop, so audio that arrives late is dropped.
  const playIdRef = useRef(0);

  const stop = useCallback(() => {
    playIdRef.current += 1;
    queueRef.current = [];
    audioRef.current?.pause();
    audioRef.current = null;
    setCurrent(null);
    setStatus("idle");
  }, []);

  const playNext = useCallback(async () => {
    const playId = playIdRef.current;
    const section = queueRef.current.shift();
    if (!section) {
      audioRef.current = null;
      setCurrent(null);
      setStatus("idle");
      return;
    }
    setCurrent(section);
    setStatus("loading");
    try {
      const { url } = await fetchAudio({ sessionId, section }, true).unwrap();
      // Stopped, or another play started, while the audio was on its way.
      if (playId !== playIdRef.current) return;
      const audio = new Audio(url);
      audio.playbackRate = speedRef.current;
      audio.onended = () => void playNext();
      audio.onerror = () => {
        queueRef.current = [];
        setStatus("error");
      };
      audioRef.current = audio;
      await audio.play();
      setStatus("playing");
    } catch {
      if (playId !== playIdRef.current) return;
      queueRef.current = [];
      setStatus("error");
    }
  }, [fetchAudio, sessionId]);

  const play = useCallback(
    (sections: string[]) => {
      playIdRef.current += 1;
      audioRef.current?.pause();
      queueRef.current = [...sections];
      void playNext();
    },
    [playNext],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    if (!audioRef.current) return;
    void audioRef.current.play().then(() => setStatus("playing"));
  }, []);

  const setSpeed = useCallback((next: ReadAloudSpeed) => {
    speedRef.current = next;
    setSpeedState(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, []);

  // Leaving the debrief stops the voice.
  useEffect(() => stop, [stop]);

  return { status, current, speed, play, pause, resume, stop, setSpeed };
};

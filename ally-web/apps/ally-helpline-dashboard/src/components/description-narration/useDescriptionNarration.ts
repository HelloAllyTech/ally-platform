import { useCallback, useEffect, useRef, useState } from "react";

export type NarrationStatus = "idle" | "loading" | "playing" | "paused" | "error";

/**
 * Plays one narration URL with an HTML5 audio element. Streams on the first
 * play, keeps position across pause/resume, and drops the element when the
 * URL changes or the learner leaves the screen.
 */
export const useDescriptionNarration = (url?: string | null) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<NarrationStatus>("idle");

  const teardown = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
    }
    audioRef.current = null;
  }, []);

  useEffect(() => {
    setStatus("idle");
    return teardown;
  }, [url, teardown]);

  const play = useCallback(async () => {
    if (!url) return;
    if (!audioRef.current) {
      const audio = new Audio(url);
      audio.onended = () => setStatus("idle");
      audio.onerror = () => setStatus("error");
      audioRef.current = audio;
    }
    setStatus("loading");
    try {
      await audioRef.current.play();
      setStatus("playing");
    } catch {
      setStatus("error");
    }
  }, [url]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setStatus("paused");
  }, []);

  const toggle = useCallback(() => {
    if (status === "playing" || status === "loading") pause();
    else void play();
  }, [status, play, pause]);

  return { status, play, pause, toggle };
};

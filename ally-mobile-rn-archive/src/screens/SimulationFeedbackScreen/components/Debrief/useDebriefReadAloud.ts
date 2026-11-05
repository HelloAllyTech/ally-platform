import {useCallback, useEffect, useRef, useState} from 'react';

import {useLazyGetDebriefCardAudioQuery} from '@/services/learnerDebriefApi';

export const READ_ALOUD_SPEEDS = [0.75, 1, 1.25] as const;
export type ReadAloudSpeed = (typeof READ_ALOUD_SPEEDS)[number];

export type ReadAloudStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'error';

/** The card being played right now, for the (hidden) player to mount. */
export interface ReadAloudTrack {
  url: string;
  /** Changes on every track, so the same card twice still restarts. */
  key: number;
}

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
  /** What the player plays; `null` when nothing is. */
  track: ReadAloudTrack | null;
  /** The player's callbacks. */
  onLoad: () => void;
  onEnd: () => void;
  onError: () => void;
}

/**
 * Read-aloud for one debrief — mirrors ally-web's useDebriefReadAloud: fetches
 * each card's audio on the first tap (the server caches it), plays the queue
 * in order and keeps the current card so the screen can highlight it. Audio is
 * never the only way to the content: an error stops playback and the cards
 * stay readable.
 *
 * Playback itself is a hidden react-native-video player (`ReadAloudPlayer`)
 * driven by `track`, `status` and `speed`; this hook only owns the queue.
 */
export const useDebriefReadAloud = (sessionId: string): ReadAloud => {
  const [fetchAudio] = useLazyGetDebriefCardAudioQuery();
  const queueRef = useRef<string[]>([]);
  const [status, setStatus] = useState<ReadAloudStatus>('idle');
  const [current, setCurrent] = useState<string | null>(null);
  const [speed, setSpeed] = useState<ReadAloudSpeed>(1);
  const [track, setTrack] = useState<ReadAloudTrack | null>(null);
  // Bumped by every play and stop, so audio that arrives late is dropped.
  const playIdRef = useRef(0);
  const trackKeyRef = useRef(0);

  const stop = useCallback(() => {
    playIdRef.current += 1;
    queueRef.current = [];
    setTrack(null);
    setCurrent(null);
    setStatus('idle');
  }, []);

  const fail = useCallback(() => {
    queueRef.current = [];
    setTrack(null);
    setStatus('error');
  }, []);

  const playNext = useCallback(async () => {
    const playId = playIdRef.current;
    const section = queueRef.current.shift();
    if (!section) {
      setTrack(null);
      setCurrent(null);
      setStatus('idle');
      return;
    }
    setCurrent(section);
    setStatus('loading');
    try {
      const {url} = await fetchAudio({sessionId, section}, true).unwrap();
      // Stopped, or another play started, while the audio was on its way.
      if (playId !== playIdRef.current) {
        return;
      }
      trackKeyRef.current += 1;
      setTrack({url, key: trackKeyRef.current});
    } catch {
      if (playId !== playIdRef.current) {
        return;
      }
      fail();
    }
  }, [fail, fetchAudio, sessionId]);

  const play = useCallback(
    (sections: string[]) => {
      playIdRef.current += 1;
      queueRef.current = [...sections];
      setTrack(null);
      playNext();
    },
    [playNext],
  );

  const pause = useCallback(() => {
    setStatus(s => (s === 'playing' ? 'paused' : s));
  }, []);

  const resume = useCallback(() => {
    setStatus(s => (s === 'paused' ? 'playing' : s));
  }, []);

  // The player loaded the card; it starts on its own unless paused meanwhile.
  const onLoad = useCallback(() => {
    setStatus(s => (s === 'loading' ? 'playing' : s));
  }, []);

  const onEnd = useCallback(() => {
    playNext();
  }, [playNext]);

  // Leaving the debrief stops the voice.
  useEffect(() => stop, [stop]);

  return {
    status,
    current,
    speed,
    play,
    pause,
    resume,
    stop,
    setSpeed,
    track,
    onLoad,
    onEnd,
    onError: fail,
  };
};

import {useCallback, useEffect, useRef, useState} from 'react';
import type {FetchBaseQueryError} from '@reduxjs/toolkit/query';

import {useLazyGetSimulationSessionRecordingQuery} from '@/services/simulationTranscriptApi';

const ERROR_REFRESH_COOLDOWN_MS = 4000;
// A non-404 failure (network blip, 5xx, timeout) doesn't mean the recording
// is actually missing, so it's worth one immediate retry before giving up —
// otherwise a one-off glitch permanently hides a recording that exists.
const MAX_LOAD_ATTEMPTS = 2;

const normalizePresignedUrl = (
  presignedUrl: string | undefined,
): string | null => {
  if (typeof presignedUrl !== 'string') {
    return null;
  }
  const trimmed = presignedUrl.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getErrorStatus = (err: unknown): number | undefined => {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const e = err as FetchBaseQueryError;
  if (typeof e.status === 'number') {
    return e.status;
  }
  return undefined;
};

export type UseSimulationSessionRecordingUrlOptions = {
  /** When true, skip calling the recording API (e.g. parent passes a fixed URL). */
  skip?: boolean;
};

/**
 * Fetches the session recording presigned URL once when the session id is set (or changes).
 * Call `refreshFromPlaybackError` if audio decode/fetch fails (e.g. expired presigned URL).
 */
export const useSimulationSessionRecordingUrl = (
  scenarioSessionId: string,
  options: UseSimulationSessionRecordingUrlOptions = {},
): {
  url: string | undefined;
  isInitialLoad: boolean;
  isMissing: boolean;
  refreshFromPlaybackError: () => void;
} => {
  const {skip = false} = options;
  const [trigger] = useLazyGetSimulationSessionRecordingQuery();

  const [presignedUrl, setPresignedUrl] = useState<string | undefined>();
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [missingOnServer, setMissingOnServer] = useState(false);

  const fetchingRef = useRef(false);
  const lastErrorRefreshRef = useRef(0);

  const loadRecording = useCallback(async () => {
    if (skip || !scenarioSessionId) {
      return;
    }
    if (fetchingRef.current) {
      return;
    }
    fetchingRef.current = true;
    try {
      for (let attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt++) {
        try {
          const result = await trigger({scenarioSessionId}).unwrap();
          const url = normalizePresignedUrl(result.presignedUrl);
          if (url) {
            setPresignedUrl(url);
            setMissingOnServer(false);
          } else {
            setPresignedUrl(undefined);
            setMissingOnServer(true);
          }
          return;
        } catch (e) {
          const status = getErrorStatus(e);
          if (status === 404) {
            setPresignedUrl(undefined);
            setMissingOnServer(true);
            return;
          }
          // Transient error: fall through and retry, up to MAX_LOAD_ATTEMPTS.
        }
      }
      // Every attempt hit a transient error. Leave the URL cleared, but don't
      // report the recording as confirmed-missing — it may still exist.
      setPresignedUrl(undefined);
    } finally {
      fetchingRef.current = false;
      setInitialLoadDone(true);
    }
  }, [scenarioSessionId, skip, trigger]);

  useEffect(() => {
    if (skip || !scenarioSessionId) {
      setPresignedUrl(undefined);
      setInitialLoadDone(true);
      setMissingOnServer(false);
      return;
    }
    setInitialLoadDone(false);
    setPresignedUrl(undefined);
    setMissingOnServer(false);
    loadRecording().catch(() => {});
  }, [scenarioSessionId, skip, loadRecording]);

  const refreshFromPlaybackError = useCallback(() => {
    const now = Date.now();
    if (now - lastErrorRefreshRef.current < ERROR_REFRESH_COOLDOWN_MS) {
      return;
    }
    lastErrorRefreshRef.current = now;
    if (!skip && scenarioSessionId && !missingOnServer) {
      loadRecording().catch(() => {});
    }
  }, [scenarioSessionId, skip, missingOnServer, loadRecording]);

  return {
    /** Presigned URL when the session has a recording; undefined → use app fallback audio. */
    url: presignedUrl,
    /** True until the first recording request finishes (success or error). */
    isInitialLoad: !skip && !initialLoadDone,
    /** Server indicated no recording (e.g. 404). */
    isMissing: missingOnServer,
    /** Call when decode/fetch of the audio file fails (e.g. expired presigned URL). */
    refreshFromPlaybackError,
  };
};

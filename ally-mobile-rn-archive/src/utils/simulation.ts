import {SESSION_AUTO_END_MINUTES} from '@/constants';
import type {TriggerWarning} from '@/types';
import {tryParseJson, uint8ToString} from '@/utils';

const SHORT_SESSION_THRESHOLD_SECONDS = 30;

export const isShortSession = (callDuration?: number): boolean => {
  if (callDuration === null || callDuration === undefined) {
    return false;
  }
  return callDuration <= SHORT_SESSION_THRESHOLD_SECONDS;
};

export const decodeFeedbackPayloadToJson = (payload: unknown): unknown => {
  if (
    payload &&
    typeof payload === 'object' &&
    typeof (payload as {length?: number}).length === 'number'
  ) {
    const raw = uint8ToString(payload as Uint8Array);
    const parsed = tryParseJson(raw);
    if (parsed) return parsed;
    return null;
  }
  return null;
};

export const getTriggerWarningNames = (
  triggerWarnings?: TriggerWarning[],
): string[] => {
  return triggerWarnings?.map(tw => tw.name) || [];
};

/**
 * Parses an "HH:MM:SS" max-time string from the backend into total seconds.
 * Falls back to SESSION_AUTO_END_MINUTES if the string is absent or invalid.
 */
export const parseMaxTimeSec = (timeStr: string | undefined): number => {
  if (!timeStr) return SESSION_AUTO_END_MINUTES * 60;
  const parts = timeStr.split(':').map(Number);
  const hours = parts[0] || 0;
  const minutes = parts[1] || 0;
  const seconds = parts[2] || 0;
  return hours * 3600 + minutes * 60 + seconds;
};

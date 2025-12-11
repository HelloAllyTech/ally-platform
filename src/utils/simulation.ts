import type {TriggerWarning} from '@/types';
import {tryParseJson, uint8ToString} from '@/utils';

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

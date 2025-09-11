import {formatDiffAsMMSS} from '@/components/DateSelector/dateUtils';
import {SimulationEvent, SimulationSummaryData} from '@/types';

export type FormattedEvent = {
  time: string;
  event: string;
  score: number | null;
};

export const formatSimulationKeyEvents = (
  summary: SimulationSummaryData | null,
): FormattedEvent[] => {
  if (!summary?.events) return [];

  return summary.events
    .slice()
    .sort(
      (a: SimulationEvent, b: SimulationEvent) =>
        (new Date(a?.createdAt || a?.occurredAt || '').getTime() || 0) -
        (new Date(b?.createdAt || b?.occurredAt || '').getTime() || 0),
    )
    .map((e: SimulationEvent) => ({
      time: formatDiffAsMMSS(
        summary?.createdAt || summary?.startedAt,
        e?.createdAt || e?.occurredAt,
      ),
      event: e?.events?.message || e?.description || '',
      score: e?.events?.score ?? e?.score ?? null,
    }));
};

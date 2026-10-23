import {FeedbackItem, SimulationEvent, SimulationSummaryData} from '@/types';
import {formatDiffAsMMSS} from '@/utils';

export type FormattedEvent = {
  time: string;
  event: string;
  score: number | null;
};

export const getImprovementsWithRecommendations = (
  data: SimulationSummaryData | null,
): (string | FeedbackItem)[] => {
  const feedback = data?.details?.summary?.feedback;
  const areasOfGrowth = feedback?.areasOfGrowth;

  if (areasOfGrowth?.length) {
    return areasOfGrowth
      .filter(item => item.improvement)
      .map(item => ({
        text: item.improvement,
        ...(item.recommendation ? {recommendation: item.recommendation} : {}),
      }));
  }

  return feedback?.improvements ?? [];
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
      event: e?.message || e?.events?.message || '',
      score: e?.score || e?.events?.score || null,
    }));
};

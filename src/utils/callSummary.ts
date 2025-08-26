import {CallSummaryGenerationData} from '@/constants';
import {Tag} from '@/services/callSummaryApi';

export const mapTagsToString = (tags: Tag[]) => {
  return tags?.map(tag => tag.tag)?.join(', ') || '';
};

export const getEstimatedSummaryGenerationTime = (callDuration: number) => {
  const estimatedGenerationTimeInseconds =
    (CallSummaryGenerationData.summaryGenerationDurationInSeconds *
      callDuration) /
    CallSummaryGenerationData.durationInSeconds;
  return Math.ceil(estimatedGenerationTimeInseconds / 60);
};

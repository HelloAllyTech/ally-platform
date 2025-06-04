import {Tag} from '@/services/callSummaryApi';

export const mapTagsToString = (tags: Tag[]) => {
  return tags?.map(tag => tag.tag)?.join(', ') || '';
};

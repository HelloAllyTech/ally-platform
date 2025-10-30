import {
  getEstimatedSummaryGenerationTime,
  mapTagsToString,
} from '../callSummary';

describe('CallSummary Utilities', () => {
  it('should map tags to a string', () => {
    const tags = [{tag: 'tag1', priority_rating: 1}, {tag: 'tag2', priority_rating: 1}];
    expect(mapTagsToString(tags)).toBe('tag1, tag2');
  });

  it('should return an empty string if no tags are provided', () => {
    expect(mapTagsToString([])).toBe('');
  });

  it('should calculate estimated summary generation time', () => {
    const callDuration = 120;
    const estimatedTime = getEstimatedSummaryGenerationTime(callDuration);
    expect(estimatedTime).toBeGreaterThan(0);
  });
});

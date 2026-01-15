export enum ReviewFilter {
  ALL = 'ALL',
  LATEST = 'LATEST',
  MOST_REVIEWED = 'MOST_REVIEWED',
  UNDISCOVERED = 'UNDISCOVERED',
}

export const REVIEW_FILTERS = [
  {
    key: ReviewFilter.ALL,
    label: 'All',
  },
  {
    key: ReviewFilter.LATEST,
    label: 'Latest',
  },
  {
    key: ReviewFilter.MOST_REVIEWED,
    label: 'Most Reviewed',
  },
  {
    key: ReviewFilter.UNDISCOVERED,
    label: 'Undiscovered',
  },
];

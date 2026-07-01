import type {TranslationType} from '@/localization/locales/type';

export enum ReviewFilter {
  ALL = 'ALL',
  LATEST = 'LATEST',
  MOST_REVIEWED = 'MOST_REVIEWED',
  UNDISCOVERED = 'UNDISCOVERED',
}

export enum ReadFilter {
  ALL = 'ALL',
  READ = 'READ',
  UNREAD = 'UNREAD',
}

export enum SortBy {
  LATEST = 'LATEST',
  MOST_VIEWED = 'MOST_VIEWED',
  MOST_COMMENTED = 'MOST_COMMENTED',
}

export const READ_FILTER_OPTIONS: {
  key: ReadFilter;
  labelKey: TranslationType;
}[] = [
  {key: ReadFilter.ALL, labelKey: 'review.filter.all'},
  {key: ReadFilter.READ, labelKey: 'review.filter.read'},
  {key: ReadFilter.UNREAD, labelKey: 'review.filter.unread'},
];

export const SORT_OPTIONS: {key: SortBy; labelKey: TranslationType}[] = [
  {key: SortBy.LATEST, labelKey: 'review.sort.latest'},
  {key: SortBy.MOST_VIEWED, labelKey: 'review.sort.mostViewed'},
  {key: SortBy.MOST_COMMENTED, labelKey: 'review.sort.mostCommented'},
];

export const REVIEW_FILTERS: {key: ReviewFilter; labelKey: TranslationType}[] =
  [
    {
      key: ReviewFilter.ALL,
      labelKey: 'review.filter.all',
    },
    {
      key: ReviewFilter.LATEST,
      labelKey: 'review.filter.latest',
    },
    {
      key: ReviewFilter.MOST_REVIEWED,
      labelKey: 'review.filter.mostReviewed',
    },
    {
      key: ReviewFilter.UNDISCOVERED,
      labelKey: 'review.filter.undiscovered',
    },
  ];

export enum ReviewType {
  SIMULATION = 'simulation',
  SCRIBE = 'scribe',
}

export const REVIEW_TYPE_TABS: {key: ReviewType; titleKey: TranslationType}[] =
  [
    {key: ReviewType.SCRIBE, titleKey: 'review.tabs.scribe'},
    {key: ReviewType.SIMULATION, titleKey: 'review.tabs.simulation'},
  ];

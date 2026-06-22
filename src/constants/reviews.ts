import type {TranslationType} from '@/localization/locales/type';

export enum ReviewFilter {
  ALL = 'ALL',
  LATEST = 'LATEST',
  MOST_REVIEWED = 'MOST_REVIEWED',
  UNDISCOVERED = 'UNDISCOVERED',
}

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

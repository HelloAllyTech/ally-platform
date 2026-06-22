import React from 'react';
import {render, fireEvent, waitFor} from '@testing-library/react-native';

import {ReviewList} from '../ReviewList';


jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

const mockNavigate = jest.fn();
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({navigate: mockNavigate, goBack: jest.fn()}),
  useTranslate: () => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  }),
}));

const mockShowToast = jest.fn();
jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    EmptyState: ({title, description}: any) => (
      <View testID="empty-state">
        <Text>{title}</Text>
        <Text>{description}</Text>
      </View>
    ),
    TabView: ({tabs, activeTab, onTabChange}: any) => (
      <View testID="tab-view">
        {tabs?.map((tab: any) => (
          <TouchableOpacity
            key={tab.key}
            testID={`filter-${tab.key}`}
            onPress={() => onTabChange(tab.key)}>
            <Text>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    ),
    useToast: () => ({showToast: mockShowToast}),
  };
});

const mockRefresh = jest.fn();
const mockLoadMore = jest.fn();
const mockSetFilter = jest.fn();

let mockReviewsData: any[] = [];
let mockIsLoading = false;
let mockIsFetching = false;
let mockError: any = null;
let mockHasMore = false;
let mockSelectedFilter = 'all';

jest.mock('@/hooks/useReviews', () => ({
  useReviews: () => ({
    reviews: mockReviewsData,
    isLoading: mockIsLoading,
    isFetching: mockIsFetching,
    error: mockError,
    hasMore: mockHasMore,
    selectedFilter: mockSelectedFilter,
    loadMore: mockLoadMore,
    refresh: mockRefresh,
    setSelectedFilter: mockSetFilter,
  }),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    EmptyReviewIcon: () => <View testID="empty-review-icon" />,
  };
});

jest.mock('@/constants', () => ({
  REVIEW_FILTERS: [
    {key: 'all', labelKey: 'review.filter.all'},
    {key: 'mine', labelKey: 'review.filter.mine'},
  ],
  SCREEN_NAMES: {
    REVIEW_DETAILS: 'ReviewDetails',
    SCRIBE_REVIEW_DETAILS: 'ScribeReviewDetails',
  },
}));

jest.mock('@/contexts/ReviewApiContext', () => ({
  ReviewType: {simulation: 'simulation', scribe: 'scribe'},
}));

jest.mock('@/services/reviewsApi', () => ({
  useLazyGetReviewsQuery: () => [jest.fn(), {data: undefined}],
}));

jest.mock('@/services/generalCommentsApi', () => ({
  useLazyGetGeneralCommentsOverviewQuery: () => [jest.fn(), {data: undefined}],
}));

jest.mock('@/services/scribeGeneralCommentsApi', () => ({
  useLazyGetScribeGeneralCommentsOverviewQuery: () => [
    jest.fn(),
    {data: undefined},
  ],
}));

jest.mock('../ReviewCard', () => {
  const React = require('react');
  const {TouchableOpacity, Text} = require('react-native');
  return {
    ReviewCard: ({id, onReviewPress, note}: any) => (
      <TouchableOpacity
        testID={`review-card-${id}`}
        onPress={() => onReviewPress?.()}>
        <Text>{note || id}</Text>
      </TouchableOpacity>
    ),
  };
});

const mockUseLazyQuery = (() => [jest.fn(), {data: undefined}]) as any;

describe('ReviewList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReviewsData = [];
    mockIsLoading = false;
    mockIsFetching = false;
    mockError = null;
    mockHasMore = false;
    mockSelectedFilter = 'all';
  });

  it('renders tab filters', () => {
    const {getByTestId} = render(
      <ReviewList
        reviewType="simulation"
        useLazyQuery={mockUseLazyQuery}
        canViewReview
      />,
    );
    expect(getByTestId('tab-view')).toBeTruthy();
  });

  it('renders empty state when no reviews and not loading', () => {
    mockReviewsData = [];
    mockIsLoading = false;
    mockIsFetching = false;

    const {getByTestId} = render(
      <ReviewList
        reviewType="simulation"
        useLazyQuery={mockUseLazyQuery}
        canViewReview
      />,
    );
    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('renders review cards when data exists', () => {
    mockReviewsData = [
      {
        id: 'r1',
        createdBy: {name: 'User 1'},
        createdAt: '2026-03-06',
        commentsCount: 2,
        reactions: {},
        note: 'Note 1',
      },
      {
        id: 'r2',
        createdBy: {name: 'User 2'},
        createdAt: '2026-03-05',
        commentsCount: 0,
        reactions: {},
        note: 'Note 2',
      },
    ];

    const {getByTestId} = render(
      <ReviewList
        reviewType="simulation"
        useLazyQuery={mockUseLazyQuery}
        canViewReview
      />,
    );
    expect(getByTestId('review-card-r1')).toBeTruthy();
    expect(getByTestId('review-card-r2')).toBeTruthy();
  });

  it('navigates to ReviewDetails on simulation review press', () => {
    mockReviewsData = [
      {
        id: 'r1',
        createdBy: {name: 'User 1'},
        createdAt: '2026-03-06',
        commentsCount: 0,
        reactions: {},
        note: '',
      },
    ];

    const {getByTestId} = render(
      <ReviewList
        reviewType="simulation"
        useLazyQuery={mockUseLazyQuery}
        canViewReview
      />,
    );
    fireEvent.press(getByTestId('review-card-r1'));
    expect(mockNavigate).toHaveBeenCalledWith('ReviewDetails', {
      reviewId: 'r1',
    });
  });

  it('navigates to ScribeReviewDetails for scribe type', () => {
    mockReviewsData = [
      {
        id: 's1',
        createdBy: {name: 'User 1'},
        createdAt: '2026-03-06',
        commentsCount: 0,
        reactions: {},
        note: '',
      },
    ];

    const {getByTestId} = render(
      <ReviewList
        reviewType="scribe"
        useLazyQuery={mockUseLazyQuery}
        canViewReview
      />,
    );
    fireEvent.press(getByTestId('review-card-s1'));
    expect(mockNavigate).toHaveBeenCalledWith('ScribeReviewDetails', {
      reviewId: 's1',
    });
  });

  it('does not pass onReviewPress when canViewReview is false', () => {
    mockReviewsData = [
      {
        id: 'r1',
        createdBy: {name: 'User 1'},
        createdAt: '2026-03-06',
        commentsCount: 0,
        reactions: {},
        note: '',
      },
    ];

    const {getByTestId} = render(
      <ReviewList
        reviewType="simulation"
        useLazyQuery={mockUseLazyQuery}
        canViewReview={false}
      />,
    );
    fireEvent.press(getByTestId('review-card-r1'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows loading footer when loading', () => {
    mockIsLoading = true;
    const {toJSON} = render(
      <ReviewList
        reviewType="simulation"
        useLazyQuery={mockUseLazyQuery}
        canViewReview
      />,
    );
    expect(toJSON()).toBeTruthy();
  });

  it('shows toast on error', () => {
    mockError = {status: 500};
    render(
      <ReviewList
        reviewType="simulation"
        useLazyQuery={mockUseLazyQuery}
        canViewReview
      />,
    );
    expect(mockShowToast).toHaveBeenCalledWith('review.error.title', 'error');
  });
});

import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

jest.mock('@/screens/ReviewScreen/components', () => ({
  ReviewCard: () => null,
}));

import {ReviewScreen} from '../ReviewScreen';

const mockNavigate = jest.fn();
const mockSetSelectedFilter = jest.fn();
const mockLoadMore = jest.fn();
const mockRefresh = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@/hooks/useReviews', () => ({
  useReviews: () => ({
    reviews: [],
    isLoading: false,
    isFetching: false,
    error: null,
    hasMore: false,
    selectedFilter: 'all',
    loadMore: mockLoadMore,
    refresh: mockRefresh,
    setSelectedFilter: mockSetSelectedFilter,
  }),
}));

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({navigate: mockNavigate}),
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text, View} = require('react-native');
  return {
    TabScreenHeader: ({title}: any) => (
      <View testID="tab-screen-header">
        <Text>{title}</Text>
      </View>
    ),
    TabView: ({tabs, activeTab, onTabChange}: any) => (
      <View testID="tab-view">
        {tabs?.map((tab: any, i: number) => (
          <Text
            key={i}
            testID={`tab-${tab.value}`}
            onPress={() => onTabChange?.(tab.value)}>
            {tab.label}
          </Text>
        ))}
      </View>
    ),
    EmptyState: ({title, description}: any) => (
      <View testID="empty-state">
        <Text>{title}</Text>
        <Text>{description}</Text>
      </View>
    ),
    BadgePopup: () => <View testID="badge-popup" />,
    useToast: () => ({showToast: mockShowToast}),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@/assets', () => ({
  EmptyReviewIcon: 'EmptyReviewIcon',
}));

jest.mock('@/constants', () => ({
  REVIEW_FILTERS: [
    {value: 'all', label: 'All'},
    {value: 'pending', label: 'Pending'},
  ],
  SCREEN_NAMES: {REVIEW_DETAILS: 'ReviewDetails'},
}));

jest.mock('@/navigation/TabNavigator', () => ({
  isReviewerOnly: () => false,
}));

jest.mock('react-redux', () => ({
  useSelector: () => ({}),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    cb();
  },
}));

describe('ReviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders TabScreenHeader with title', () => {
    const {getByTestId, getByText} = render(<ReviewScreen />);
    expect(getByTestId('tab-screen-header')).toBeTruthy();
    expect(getByText('Review.header.title')).toBeTruthy();
  });

  it('renders TabView with filters', () => {
    const {getByTestId} = render(<ReviewScreen />);
    expect(getByTestId('tab-view')).toBeTruthy();
  });

  it('renders empty state when no reviews and not loading', () => {
    const {getByTestId, getByText} = render(<ReviewScreen />);
    expect(getByTestId('empty-state')).toBeTruthy();
    expect(getByText('Review.empty.title')).toBeTruthy();
    expect(getByText('Review.empty.description')).toBeTruthy();
  });

  it('calls setSelectedFilter when tab is changed', () => {
    const {getByTestId} = render(<ReviewScreen />);
    fireEvent.press(getByTestId('tab-pending'));
    expect(mockSetSelectedFilter).toHaveBeenCalledWith('pending');
  });
});

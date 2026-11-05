import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('@/screens/ReviewScreen/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    ReviewList: ({reviewType}: any) => (
      <View testID={`review-list-${reviewType}`}>
        <Text>ReviewList</Text>
      </View>
    ),
    ReviewCard: () => null,
  };
});

import {ReviewScreen} from '../ReviewScreen';

const mockShowToast = jest.fn();

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({navigate: jest.fn()}),
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
    BadgePopup: () => <View testID="badge-popup" />,
    useToast: () => ({showToast: mockShowToast}),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('react-native-tab-view', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    TabView: ({renderScene, navigationState}: any) => (
      <View testID="rn-tab-view">
        {navigationState.routes.map((route: any) => (
          <View key={route.key} testID={`tab-scene-${route.key}`}>
            {renderScene({route})}
          </View>
        ))}
      </View>
    ),
    TabBar: (props: any) => <View testID="rn-tab-bar" />,
  };
});

jest.mock('@/services/reviewsApi', () => ({
  useLazyGetReviewsQuery: jest.fn(),
}));

jest.mock('@/services/scribeReviewsApi', () => ({
  useLazyGetScribeReviewsQuery: jest.fn(),
}));

jest.mock('@/config/env', () => ({
  env: {SCRIBE_REVIEW_ENABLED: true},
}));

jest.mock('@/constants', () => ({
  REVIEW_TYPE_TABS: [
    {key: 'simulation', titleKey: 'review.tabs.simulation'},
    {key: 'scribe', titleKey: 'review.tabs.scribe'},
  ],
  ReviewType: {SIMULATION: 'simulation', SCRIBE: 'scribe'},
  USER_PERMISSIONS: {
    VIEW_SIMULATION_REVIEW: 'view:simulation-review',
    VIEW_SIMULATION_REVIEWS: 'view:simulation-reviews',
    VIEW_SCRIBE_REVIEW: 'view:scribe-review',
    VIEW_SCRIBE_REVIEWS: 'view:scribe-reviews',
  },
}));

jest.mock('@/navigation/TabNavigator', () => ({
  isReviewerOnly: () => false,
}));

jest.mock('react-redux', () => ({
  useSelector: () => [
    'view:simulation-reviews',
    'view:scribe-reviews',
    'view:simulation-review',
    'view:scribe-review',
  ],
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
    expect(getByText('review.title')).toBeTruthy();
  });

  it('renders tab view when user has both permissions', () => {
    const {getByTestId} = render(<ReviewScreen />);
    expect(getByTestId('rn-tab-view')).toBeTruthy();
  });

  it('renders simulation and scribe review lists', () => {
    const {getByTestId} = render(<ReviewScreen />);
    expect(getByTestId('review-list-simulation')).toBeTruthy();
    expect(getByTestId('review-list-scribe')).toBeTruthy();
  });
});

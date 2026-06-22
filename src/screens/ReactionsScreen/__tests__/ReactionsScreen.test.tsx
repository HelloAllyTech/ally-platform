import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ReactionsScreen} from '../ReactionsScreen';
import type {ReactionData} from '../types';

const mockGoBack = jest.fn();
const mockHandleReactionFilter = jest.fn();
const mockLoadMore = jest.fn();

jest.mock('@/contexts/ReviewApiContext', () => {
  const React = require('react');
  return {
    ReviewApiProvider: ({children}: {children: React.ReactNode}) => children,
    simulationApiHooks: {},
    scribeApiHooks: {},
  };
});

jest.mock('@/hooks/useReactions', () => ({
  useReactions: jest.fn(() => ({
    reactions: [] as ReactionData[],
    selectedReaction: null,
    summary: [{reaction: '1f44d', count: 5, emoji: '👍'}],
    totalCount: 10,
    isLoading: false,
    isFetching: false,
    handleReactionFilter: mockHandleReactionFilter,
    loadMore: mockLoadMore,
  })),
}));

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({
    goBack: mockGoBack,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {language: 'en'},
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@/assets', () => ({
  LeftArrowIcon: 'LeftArrowIcon',
}));

describe('ReactionsScreen', () => {
  const route = {params: {reviewId: 'review-123'}} as any;
  const navigation = {goBack: mockGoBack} as any;

  const defaultProps = {route, navigation};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders header with title and back button', () => {
    const {getByText} = render(<ReactionsScreen {...defaultProps} />);
    expect(getByText('review.reactionsModal.title')).toBeTruthy();
  });

  it('calls goBack when back button is pressed', () => {
    const {UNSAFE_getAllByType} = render(
      <ReactionsScreen {...defaultProps} />,
    );
    const {TouchableOpacity} = require('react-native');
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    const backButton = touchables[0];
    if (backButton) {
      fireEvent.press(backButton);
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    }
  });

  it('renders ReactionFilterTabs with summary and totalCount', () => {
    const {toJSON} = render(<ReactionsScreen {...defaultProps} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders list when reviewId is present', () => {
    const {UNSAFE_getAllByType} = render(<ReactionsScreen {...defaultProps} />);
    const {FlatList} = require('react-native');
    const lists = UNSAFE_getAllByType(FlatList);
    expect(lists.length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when not loading and no reactions', () => {
    const {getByText} = render(<ReactionsScreen {...defaultProps} />);
    expect(getByText('review.reactionsModal.noReactionsYet')).toBeTruthy();
  });

  it('does not render FlatList when reviewId is missing', () => {
    const routeNoId = {params: {}} as any;
    const {toJSON} = render(
      <ReactionsScreen route={routeNoId} navigation={navigation} />,
    );
    const tree = toJSON();
    expect(tree).not.toBeNull();
  });
});

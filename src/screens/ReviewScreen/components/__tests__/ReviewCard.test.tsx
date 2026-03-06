import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ReviewCard} from '../ReviewCard';
import type {ReviewScenario, ScenarioSessionData, User} from '@/types/reviews';

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

jest.mock('@/services/reviewThreadsApi', () => ({
  useLazyGetThreadsQuery: () => [
    jest.fn(),
    {data: undefined, isLoading: false},
  ],
}));

jest.mock('@/services/reviewsApi', () => ({
  useLazyGetGeneralReviewCommentsQuery: () => [
    jest.fn(),
    {data: undefined, isLoading: false},
  ],
}));

jest.mock('@/assets', () => ({
  ChatAddOnIcon: 'ChatAddOnIcon',
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    UserProfileImage: ({name, profileImageUri}: any) => (
      <View testID="user-profile-image">
        <Text>{name || (profileImageUri ? 'img' : '')}</Text>
      </View>
    ),
    VideoPreview: () => <View testID="video-preview" />,
    SimulationDetailsCard: ({title, description}: any) => (
      <View testID="simulation-details-card">
        <Text>{title}</Text>
        <Text>{description}</Text>
      </View>
    ),
  };
});

jest.mock('@/components/SimulationDetailsCard/SimulationDetailRow', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    SimulationDetailRow: ({label, value}: any) => (
      <View testID="simulation-detail-row">
        <Text>{label}</Text>
        <Text>{value}</Text>
      </View>
    ),
  };
});

jest.mock('@/utils', () => ({
  formatDateTime: (d: string) => `date-${d}`,
  formatDurationFromSeconds: (s: number) => `${s}s`,
  formatRelativeTime: (d: string) => `relative-${d}`,
  pluralize: (n: number, s: string) => (n === 1 ? `1 ${s}` : `${n} ${s}s`),
}));

jest.mock('../ExpandedComments', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    ExpandedComments: ({isExpanded}: any) =>
      isExpanded ? <Text testID="expanded-comments">Expanded</Text> : null,
  };
});

jest.mock('../ReactionsCount', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    ReactionsCount: ({totalReactions}: any) => (
      <Text testID="reactions-count">{totalReactions} reactions</Text>
    ),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {language: 'en'},
  }),
}));

const mockUser: User = {
  id: 1,
  name: 'Test User',
  profileImage: '',
};

const mockScenario: ReviewScenario = {
  title: 'Test Scenario',
  description: 'Scenario description',
  coverVideoUrl: undefined,
  coverImageUrl: undefined,
  createdAt: '2024-01-01T12:00:00Z',
};

const mockSession: ScenarioSessionData = {
  id: 'session-1',
  createdAt: '2024-01-01T12:00:00Z',
  duration: '90',
};

const defaultProps = {
  id: 'review-1',
  user: mockUser,
  scenario: mockScenario,
  createdAt: '2024-01-01T12:00:00Z',
  scenarioSession: mockSession,
  commentsCount: 2,
  reactions: {'1f44d': 3, '2764-fe0f': 1},
  onReviewPress: jest.fn(),
  onCommentPress: jest.fn(),
  isExpanded: false,
};

describe('ReviewCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    const {toJSON} = render(<ReviewCard {...defaultProps} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders user name and scenario title', () => {
    const {getAllByText, getByText} = render(<ReviewCard {...defaultProps} />);
    expect(getAllByText('Test User').length).toBeGreaterThan(0);
    expect(getByText('Test Scenario')).toBeTruthy();
  });

  it('renders detail rows', () => {
    const {getByText} = render(<ReviewCard {...defaultProps} />);
    expect(getByText('Review.card.dateAndTime')).toBeTruthy();
    expect(getByText('date-2024-01-01T12:00:00Z')).toBeTruthy();
    expect(getByText('Review.card.duration')).toBeTruthy();
    expect(getByText('90s')).toBeTruthy();
  });

  it('renders review transcript button', () => {
    const {getByText} = render(<ReviewCard {...defaultProps} />);
    expect(getByText('Review.card.reviewTranscript')).toBeTruthy();
  });

  it('calls onReviewPress when review transcript is pressed', () => {
    const onReviewPress = jest.fn();
    const {getByText} = render(
      <ReviewCard {...defaultProps} onReviewPress={onReviewPress} />,
    );
    fireEvent.press(getByText('Review.card.reviewTranscript'));
    expect(onReviewPress).toHaveBeenCalledWith('review-1');
  });

  it('renders reactions and comments count', () => {
    const {getByTestId, getByText} = render(<ReviewCard {...defaultProps} />);
    expect(getByTestId('reactions-count')).toBeTruthy();
    expect(getByText('2 Review.card.comments')).toBeTruthy();
  });

  it('calls onCommentPress when comment count is pressed', () => {
    const onCommentPress = jest.fn();
    const {getByText} = render(
      <ReviewCard {...defaultProps} onCommentPress={onCommentPress} />,
    );
    fireEvent.press(getByText('2 Review.card.comments'));
    expect(onCommentPress).toHaveBeenCalledWith('review-1');
  });

  it('renders ExpandedComments when isExpanded is true', () => {
    const {getByTestId} = render(
      <ReviewCard {...defaultProps} isExpanded />,
    );
    expect(getByTestId('expanded-comments')).toBeTruthy();
  });

  it('does not render ExpandedComments when isExpanded is false', () => {
    const {queryByTestId} = render(<ReviewCard {...defaultProps} />);
    expect(queryByTestId('expanded-comments')).toBeNull();
  });

  it('renders with user profile image when provided', () => {
    const userWithImage = {...mockUser, profileImage: 'https://example.com/avatar.png'};
    const {getByTestId} = render(
      <ReviewCard {...defaultProps} user={userWithImage} />,
    );
    expect(getByTestId('user-profile-image')).toBeTruthy();
  });
});

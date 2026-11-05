import React from 'react';
import {render} from '@testing-library/react-native';

import {ShareCallLogScreen} from '../ShareCallLogScreen';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

const mockGoBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({
    goBack: mockGoBack,
    navigate: jest.fn(),
    replace: mockReplace,
  }),
  useShareScreenLogic: () => ({
    note: '',
    setNote: jest.fn(),
    onSubmit: jest.fn(),
    screenTitle: 'SimulationFeedback.shareForReviewTitle',
    buttonLabel: 'SimulationFeedback.share',
    isEmojiPickerOpen: false,
    setIsEmojiPickerOpen: jest.fn(),
    handleEmojiSelected: jest.fn(),
    goBack: mockGoBack,
    maxNoteLength: 250,
  }),
}));

jest.mock('@/services/scribeReviewsApi', () => ({
  useCreateScribeReviewMutation: () => [jest.fn(), {isLoading: false}],
  useUpdateScribeReviewStatusMutation: () => [jest.fn(), {isLoading: false}],
}));

jest.mock('@/utils', () => ({
  formatDateTime: (d: string) => `formatted-${d}`,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('rn-emoji-keyboard', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: () => <View testID="emoji-keyboard" />,
  };
});

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    AddReactionIcon: () => <View testID="add-reaction-icon" />,
    CloseIcon: () => <View testID="close-icon" />,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {TextInput, TouchableOpacity, Text, View} = require('react-native');
  return {
    Button: ({label, onPress}: any) => (
      <TouchableOpacity testID="submit-button" onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    LineTextInput: ({value, onChangeText, placeholder}: any) => (
      <TextInput
        testID="note-input"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
      />
    ),
    SimulationDetailsCard: ({title, reviewType, description}: any) => (
      <View testID="simulation-details-card">
        <Text>{title}</Text>
        <Text>{reviewType}</Text>
        {description}
      </View>
    ),
    SimulationDetailRow: ({label, value}: any) => (
      <View testID="simulation-detail-row">
        <Text>{label}</Text>
        <Text>{value}</Text>
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

const mockRoute = {
  params: {
    scribeSessionId: 123,
    reviewId: '',
    sessionData: {
      title: 'Call Summary',
      createdAt: '2026-03-06T10:00:00Z',
      duration: '2:30',
    },
    note: '',
  },
  key: 'ShareCallLog',
  name: 'ShareCallLog' as const,
};

describe('ShareCallLogScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the share layout with session title', () => {
    const {getByText} = render(
      <ShareCallLogScreen route={mockRoute} navigation={{} as any} />,
    );
    expect(getByText('Call Summary')).toBeTruthy();
  });

  it('renders date and time detail row', () => {
    const {getByText} = render(
      <ShareCallLogScreen route={mockRoute} navigation={{} as any} />,
    );
    expect(getByText('review.details.dateAndTime')).toBeTruthy();
    expect(getByText('formatted-2026-03-06T10:00:00Z')).toBeTruthy();
  });

  it('renders duration detail row when provided', () => {
    const {getByText} = render(
      <ShareCallLogScreen route={mockRoute} navigation={{} as any} />,
    );
    expect(getByText('review.feedCard.duration')).toBeTruthy();
    expect(getByText('2:30')).toBeTruthy();
  });

  it('does not render duration when undefined', () => {
    const routeNoDuration = {
      ...mockRoute,
      params: {
        ...mockRoute.params,
        sessionData: {
          ...mockRoute.params.sessionData,
          duration: undefined,
        },
      },
    };
    const {queryByText} = render(
      <ShareCallLogScreen route={routeNoDuration} navigation={{} as any} />,
    );
    expect(queryByText('review.feedCard.duration')).toBeNull();
  });

  it('renders simulation details card with scribe reviewType', () => {
    const {getByText} = render(
      <ShareCallLogScreen route={mockRoute} navigation={{} as any} />,
    );
    expect(getByText('scribe')).toBeTruthy();
  });
});

import React from 'react';
import {render} from '@testing-library/react-native';

import {ShareSimulationScreen} from '../ShareSimulationScreen';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

const mockOnSubmit = jest.fn();
jest.mock('@/hooks/useShareScreenLogic', () => ({
  useShareScreenLogic: () => ({
    note: 'test note',
    setNote: jest.fn(),
    onSubmit: mockOnSubmit,
    screenTitle: 'Share for Review',
    buttonLabel: 'Share',
    isEmojiPickerOpen: false,
    setIsEmojiPickerOpen: jest.fn(),
    handleEmojiSelected: jest.fn(),
    goBack: jest.fn(),
    maxNoteLength: 250,
  }),
}));

jest.mock('@/services', () => ({
  useCreateReviewMutation: () => [jest.fn(), {isLoading: false}],
  useUpdateReviewStatusMutation: () => [jest.fn(), {isLoading: false}],
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
    SimulationDetailsCard: ({title, description, reviewType}: any) => (
      <View testID="simulation-details-card">
        <Text>{title}</Text>
        <Text>{reviewType}</Text>
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
    scenarioSessionId: 'session-1',
    reviewId: '',
    scenarioData: {
      coverImageUrl: 'https://example.com/img.jpg',
      coverVideoUrl: '',
      title: 'Test Scenario',
      description: 'Test description',
      createdAt: '2026-03-06T10:00:00Z',
      duration: '5:00',
    },
  },
  key: 'ShareSimulation',
  name: 'ShareSimulation' as const,
};

describe('ShareSimulationScreen', () => {
  it('renders the share layout with scenario details', () => {
    const {getByText} = render(
      <ShareSimulationScreen route={mockRoute} navigation={{} as any} />,
    );
    expect(getByText('Share for Review')).toBeTruthy();
    expect(getByText('Test Scenario')).toBeTruthy();
  });

  it('renders date and time detail row', () => {
    const {getByText} = render(
      <ShareSimulationScreen route={mockRoute} navigation={{} as any} />,
    );
    expect(getByText('review.details.dateAndTime')).toBeTruthy();
    expect(getByText('formatted-2026-03-06T10:00:00Z')).toBeTruthy();
  });

  it('renders duration detail row when provided', () => {
    const {getByText} = render(
      <ShareSimulationScreen route={mockRoute} navigation={{} as any} />,
    );
    expect(getByText('review.feedCard.duration')).toBeTruthy();
    expect(getByText('5:00')).toBeTruthy();
  });

  it('does not render duration when undefined', () => {
    const routeNoDuration = {
      ...mockRoute,
      params: {
        ...mockRoute.params,
        scenarioData: {
          ...mockRoute.params.scenarioData,
          duration: undefined,
        },
      },
    };
    const {queryByText} = render(
      <ShareSimulationScreen
        route={routeNoDuration}
        navigation={{} as any}
      />,
    );
    expect(queryByText('review.feedCard.duration')).toBeNull();
  });
});

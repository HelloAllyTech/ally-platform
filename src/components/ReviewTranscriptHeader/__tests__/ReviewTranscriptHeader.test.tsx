import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ReviewTranscriptHeader} from '../ReviewTranscriptHeader';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    HelpIcon: (props: any) =>
      React.createElement(View, {...props, testID: 'help-icon'}),
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ReviewTypeChip: () => React.createElement(View, {testID: 'review-type-chip'}),
    UserProfileImage: () =>
      React.createElement(View, {testID: 'user-profile-image'}),
  };
});

jest.mock('@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    SimulationDetailsModal: ({
      visible,
      onClose,
      title,
      description,
    }: {
      visible: boolean;
      onClose: () => void;
      title: string;
      description?: string;
    }) =>
      visible
        ? React.createElement(
            View,
            {testID: 'simulation-details-modal'},
            React.createElement(Text, null, title),
            description && React.createElement(Text, null, description),
            React.createElement(TouchableOpacity, {
              testID: 'modal-close',
              onPress: onClose,
            }, 'Close'),
          )
        : null,
  };
});

jest.mock('@/utils', () => ({
  formatDateTime: (date: string) => `formatted-${date}`,
  formatDurationFromSeconds: (sec: number) => `${sec}s`,
}));

const defaultUser = {
  id: 1,
  name: 'Test User',
  profileImage: '',
};

const defaultScenario = {
  title: 'Scenario Title',
  description: 'Scenario description',
  coverImageUrl: 'https://example.com/cover.jpg',
  coverVideoUrl: undefined,
  createdAt: '2024-01-01T00:00:00Z',
};

const defaultSession = {
  id: 'session-1',
  createdAt: '2024-01-01T12:00:00Z',
  duration: '120',
};

describe('ReviewTranscriptHeader', () => {
  it('renders scenario title', () => {
    const {getByText} = render(
      <ReviewTranscriptHeader
        user={defaultUser}
        scenario={defaultScenario}
      />,
    );
    expect(getByText('Scenario Title')).toBeTruthy();
  });

  it('renders review type chip', () => {
    const {getByTestId} = render(
      <ReviewTranscriptHeader
        user={defaultUser}
        scenario={defaultScenario}
      />,
    );
    expect(getByTestId('review-type-chip')).toBeTruthy();
  });

  it('renders user name in subtitle when provided', () => {
    const {getByText} = render(
      <ReviewTranscriptHeader
        user={defaultUser}
        scenario={defaultScenario}
      />,
    );
    expect(getByText(/By Test User/)).toBeTruthy();
  });

  it('renders session date when scenarioSession is provided', () => {
    const {getByText} = render(
      <ReviewTranscriptHeader
        user={defaultUser}
        scenario={defaultScenario}
        scenarioSession={defaultSession}
      />,
    );
    expect(getByText(/formatted-2024-01-01T12:00:00Z/)).toBeTruthy();
  });

  it('renders duration when scenarioSession has duration', () => {
    const {getByText} = render(
      <ReviewTranscriptHeader
        user={defaultUser}
        scenario={defaultScenario}
        scenarioSession={defaultSession}
      />,
    );
    expect(getByText(/Review.card.duration/)).toBeTruthy();
    expect(getByText(/120s/)).toBeTruthy();
  });

  it('opens simulation details modal when help icon is pressed', () => {
    const {getByTestId, queryByTestId, UNSAFE_getAllByType} = render(
      <ReviewTranscriptHeader
        user={defaultUser}
        scenario={defaultScenario}
      />,
    );
    expect(queryByTestId('simulation-details-modal')).toBeNull();

    const {TouchableOpacity} = require('react-native');
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    expect(touchables.length).toBeGreaterThan(0);
    fireEvent.press(touchables[0]);
    expect(getByTestId('simulation-details-modal')).toBeTruthy();
  });

  it('renders without scenario', () => {
    const {queryByText} = render(
      <ReviewTranscriptHeader user={defaultUser} />,
    );
    expect(queryByText('Scenario Title')).toBeNull();
  });

  it('renders without user name when user has no name', () => {
    const {queryByText} = render(
      <ReviewTranscriptHeader
        user={{...defaultUser, name: ''}}
        scenario={defaultScenario}
      />,
    );
    expect(queryByText(/By/)).toBeNull();
  });
});

jest.mock('@/hooks', () => {
  const en = require('@/localization/locales/en.json');
  const resolve = (key, vars = {}) => {
    const val = String(key)
      .split('.')
      .reduce((o, p) => (o == null ? undefined : o[p]), en);
    let s = typeof val === 'string' ? val : key;
    Object.keys(vars || {}).forEach(k => {
      s = s.split('{{' + k + '}}').join(String(vars[k]));
    });
    return s;
  };
  return {useTranslate: () => ({t: resolve, tVariable: resolve})};
});

import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ReviewTranscriptHeader} from '../../ReviewTranscriptDetails/ReviewTranscriptHeader';

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
  htmlToPlainText: (s: string | undefined | null) => s ?? '',
}));

const defaultUser = {
  id: 1,
  name: 'Test User',
  profileImage: '',
};

const defaultSessionDetails = {
  title: 'Scenario Title',
  description: 'Scenario description',
  coverImageUrl: 'https://example.com/cover.jpg',
  coverVideoUrl: undefined,
};

const defaultProps = {
  reviewType: 'simulation' as const,
  title: 'Scenario Title',
  user: defaultUser,
};

describe('ReviewTranscriptHeader', () => {
  it('renders title', () => {
    const {getByText} = render(
      <ReviewTranscriptHeader {...defaultProps} />,
    );
    expect(getByText('Scenario Title')).toBeTruthy();
  });

  it('renders review type chip', () => {
    const {getByTestId} = render(
      <ReviewTranscriptHeader {...defaultProps} />,
    );
    expect(getByTestId('review-type-chip')).toBeTruthy();
  });

  it('renders user name in subtitle when provided', () => {
    const {getByText} = render(
      <ReviewTranscriptHeader {...defaultProps} />,
    );
    expect(getByText(/By Test User/)).toBeTruthy();
  });

  it('renders session date when createdAt is provided', () => {
    const {getByText} = render(
      <ReviewTranscriptHeader
        {...defaultProps}
        createdAt="2024-01-01T12:00:00Z"
      />,
    );
    expect(getByText(/formatted-2024-01-01T12:00:00Z/)).toBeTruthy();
  });

  it('renders duration when duration is provided', () => {
    const {getByText} = render(
      <ReviewTranscriptHeader
        {...defaultProps}
        createdAt="2024-01-01T12:00:00Z"
        duration={120}
      />,
    );
    expect(getByText(/Duration/)).toBeTruthy();
    expect(getByText(/120s/)).toBeTruthy();
  });

  it('opens simulation details modal when help icon is pressed', () => {
    const {getByTestId, queryByTestId, UNSAFE_getAllByType} = render(
      <ReviewTranscriptHeader
        {...defaultProps}
        sessionDetails={defaultSessionDetails}
      />,
    );
    expect(queryByTestId('simulation-details-modal')).toBeNull();

    const {TouchableOpacity} = require('react-native');
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    expect(touchables.length).toBeGreaterThan(0);
    fireEvent.press(touchables[0]);
    expect(getByTestId('simulation-details-modal')).toBeTruthy();
  });

  it('renders without session details', () => {
    const {getByText, queryByTestId} = render(
      <ReviewTranscriptHeader {...defaultProps} />,
    );
    expect(getByText('Scenario Title')).toBeTruthy();
    expect(queryByTestId('simulation-details-modal')).toBeNull();
  });

  it('renders without user name when user has no name', () => {
    const {queryByText} = render(
      <ReviewTranscriptHeader
        {...defaultProps}
        user={{...defaultUser, name: ''}}
      />,
    );
    expect(queryByText(/By/)).toBeNull();
  });
});

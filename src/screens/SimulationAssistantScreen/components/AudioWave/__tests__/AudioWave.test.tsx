import React from 'react';
import {render} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {AudioWave} from '../AudioWave';

jest.mock('@livekit/react-native', () => ({
  __esModule: true,
  useRemoteParticipants: () => [
    {
      getTrackPublications: () => [{kind: 'audio'}],
      on: jest.fn(),
      off: jest.fn(),
      isSpeaking: false,
    },
  ],
}));

jest.mock('livekit-client', () => ({
  Track: {Kind: {Audio: 'audio'}, Source: {Microphone: 'mic'}},
  ParticipantEvent: {IsSpeakingChanged: 'IsSpeakingChanged'},
}));

// Mock hook used within AudioWave
jest.mock('../useAudioLevel', () => ({
  useAudioLevel: () => 0.5,
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  return ({children}: any) => React.createElement('LinearGradient', null, children);
});

const renderWithProviders = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: {x: 0, y: 0, width: 375, height: 812},
        insets: {top: 0, left: 0, right: 0, bottom: 0},
      }}>
      {ui}
    </SafeAreaProvider>,
  );

describe('AudioWave', () => {
  it('renders visualizer and optional avatar', () => {
    const {toJSON, rerender} = renderWithProviders(
      <AudioWave avatarUrl="https://example.com/a.png" />,
    );
    expect(toJSON()).toBeTruthy();

    rerender(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        <AudioWave avatarUrl={null} />
      </SafeAreaProvider>,
    );
    expect(toJSON()).toBeTruthy();
  });
});



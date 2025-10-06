import React from 'react';
import {render} from '@testing-library/react-native';

import {AudioWave} from '../AudioWave';

jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('react-native-size-matters', () => ({ScaledSheet: {create: (s: any) => s}, ms: (n: number) => n}));

jest.mock('@livekit/react-native', () => ({
  useRemoteParticipants: () => [],
}));

jest.mock('livekit-client', () => ({
  Track: {Kind: {Audio: 'audio'}, Source: {Microphone: 'mic'}},
}));

describe('AudioWave (low coverage)', () => {
  it('renders without crashing', () => {
    render(<AudioWave avatarUrl={null} />);
  });
});

import React from 'react';
import {Text, AppState} from 'react-native';
import {act, render, waitFor} from '@testing-library/react-native';

import {useLiveAudioStream} from '../useLiveAudioStream';

jest.useFakeTimers();

jest.mock('react-native-live-audio-stream', () => ({
  init: jest.fn(),
  on: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
}));

jest.mock('react-native-permissions', () => ({
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', BLOCKED: 'blocked', UNAVAILABLE: 'unavailable' },
  check: jest.fn(async () => 'granted'),
  request: jest.fn(async () => 'granted'),
  openSettings: jest.fn(async () => {}),
}));

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({ goBack: jest.fn(), reset: jest.fn(), navigate: jest.fn() }),
  usePermissionAlert: () => ({ showSettingsAlert: jest.fn() }),
}));

jest.mock('@/constants', () => ({ MICROPHONE_PERMISSION: 'perm' }));
jest.mock('@/constants/general', () => ({ isIOS: true, MICROPHONE_AUDIO_SAMPLE_RATE: 44100 }));

describe('useLiveAudioStream', () => {
  const Test = ({enableLiveAudio = true}: {enableLiveAudio?: boolean}) => {
    const {isStreaming, startStreaming, stopStreaming, isPermissionGranted} = useLiveAudioStream({
      enableLiveAudio,
      onAudioData: jest.fn(),
    });
    return (
      <>
        <Text testID="perm">{String(isPermissionGranted)}</Text>
        <Text testID="start" onPress={startStreaming} />
        <Text testID="stop" onPress={stopStreaming} />
        <Text testID="streaming">{String(isStreaming)}</Text>
      </>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes audio when permission is granted and starts/stops streaming', async () => {
    const {getByTestId} = render(<Test />);
    await waitFor(() => expect(getByTestId('perm').props.children).toBe('true'));

    await act(async () => {
      getByTestId('start').props.onPress();
      jest.advanceTimersByTime(1100);
    });
    expect(getByTestId('streaming').props.children).toBe('true');

    await act(async () => {
      getByTestId('stop').props.onPress();
    });
    expect(getByTestId('streaming').props.children).toBe('false');
  });

  it('when coming to foreground without permission, rechecks', async () => {
    const perms = require('react-native-permissions');
    perms.check.mockResolvedValueOnce('denied');
    const {getByTestId} = render(<Test />);
    await waitFor(() => expect(getByTestId('perm').props.children).toBe('false'));

    await act(async () => {
      // simulate app coming active
      (AppState as any)._currentState = 'background';
      (AppState as any).emit?.('change', 'active');
    });
  });

  it('requests permission when not granted on mount', async () => {
    const perms = require('react-native-permissions');
    perms.check.mockResolvedValueOnce('denied');
    perms.request.mockResolvedValueOnce('granted');
    const {getByTestId} = render(<Test />);
    await waitFor(() => expect(getByTestId('perm').props.children).toBe('true'));
  });

  it('shows settings alert when permission remains denied after request', async () => {
    const perms = require('react-native-permissions');
    perms.check.mockResolvedValueOnce('denied');
    perms.request.mockResolvedValueOnce('denied');
    const hooks = require('@/hooks');
    render(<Test />);
    expect(hooks.usePermissionAlert().showSettingsAlert).toBeTruthy();
  });
});

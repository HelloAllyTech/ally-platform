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

  it('never starts the recorder before it has been initialised', async () => {
    // Permission stays pending, so init() never runs. start() here would be a
    // null dereference inside the native module.
    const perms = require('react-native-permissions');
    const audio = require('react-native-live-audio-stream');
    let grant: (status: string) => void = () => {};
    perms.check.mockReturnValueOnce(
      new Promise(resolve => {
        grant = resolve;
      }),
    );

    const {getByTestId} = render(<Test />);

    await act(async () => {
      getByTestId('start').props.onPress();
      jest.advanceTimersByTime(5000);
    });

    expect(audio.init).not.toHaveBeenCalled();
    expect(audio.start).not.toHaveBeenCalled();
    expect(getByTestId('streaming').props.children).toBe('false');

    // The pending request is honoured as soon as permission lands.
    await act(async () => {
      grant('granted');
    });

    expect(audio.init).toHaveBeenCalledTimes(1);
    expect(audio.start).toHaveBeenCalledTimes(1);
    expect(getByTestId('streaming').props.children).toBe('true');
  });

  it('starts the recorder once, however often it is asked', async () => {
    const audio = require('react-native-live-audio-stream');
    const {getByTestId} = render(<Test />);
    await waitFor(() => expect(getByTestId('perm').props.children).toBe('true'));

    await act(async () => {
      getByTestId('start').props.onPress();
      getByTestId('start').props.onPress();
    });

    expect(audio.start).toHaveBeenCalledTimes(1);
  });

  it('keeps recording when the app returns to the foreground', async () => {
    const audio = require('react-native-live-audio-stream');
    const {getByTestId} = render(<Test />);
    await waitFor(() => expect(getByTestId('perm').props.children).toBe('true'));

    await act(async () => {
      getByTestId('start').props.onPress();
    });

    // The permission re-check used to re-run an effect whose cleanup stopped the
    // recorder, cutting a live session short.
    await act(async () => {
      (AppState as any)._currentState = 'background';
      (AppState as any).emit?.('change', 'active');
      jest.advanceTimersByTime(1000);
    });

    expect(audio.stop).not.toHaveBeenCalled();
    expect(getByTestId('streaming').props.children).toBe('true');
  });

  it('when coming to foreground without permission, rechecks', async () => {
    const perms = require('react-native-permissions');
    perms.check.mockResolvedValueOnce('denied');
    const {getByTestId} = render(<Test />);
    await waitFor(() => expect(getByTestId('perm').props.children).toBe('false'));
    expect(perms.check).toHaveBeenCalledTimes(1);

    // The permission re-check on foregrounding should fire another check, and
    // this time the default mock will return 'granted'.
    await act(async () => {
      (AppState as any)._currentState = 'background';
      (AppState as any).emit?.('change', 'active');
    });
    await waitFor(() => expect(getByTestId('perm').props.children).toBe('true'));
  });

  it('requests permission when not granted on mount', async () => {
    const perms = require('react-native-permissions');
    perms.check.mockResolvedValueOnce('denied');
    perms.request.mockResolvedValueOnce('granted');
    const {getByTestId} = render(<Test />);
    await act(async () => { await Promise.resolve(); }); // Flush microtasks for permission check/request resolution
    await waitFor(() => expect(getByTestId('perm').props.children).toBe('true'));
  });

  it('shows settings alert when permission remains denied after request', async () => {
    const perms = require('react-native-permissions');
    perms.check.mockResolvedValueOnce('denied');
    perms.request.mockResolvedValueOnce('denied');
    const hooks = require('@/hooks');
    render(<Test />);
    await act(async () => { await Promise.resolve(); }); // Flush microtasks
    expect(hooks.usePermissionAlert().showSettingsAlert).toBeTruthy();
  });
});

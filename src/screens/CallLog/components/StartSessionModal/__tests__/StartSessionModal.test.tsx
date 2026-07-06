import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {StartSessionModal} from '@/screens/CallLog/components/StartSessionModal/StartSessionModal';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/assets', () => ({ CloseIcon: () => null }));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text, View} = require('react-native');
  return {
    Button: ({onPress, label}: any) => (
      <Text onPress={onPress}>{label}</Text>
    ),
    SecurityCarousel: () => <View testID="security-carousel" />,
    NotificationModal: ({visible, onConfirm}: any) =>
      visible ? (
        <View testID="notification-modal">
          <Text>Before you get started</Text>
          <Text onPress={onConfirm}>Start Session</Text>
        </View>
      ) : null,
  };
});

describe('StartSessionModal', () => {
  it('returns null when not visible', () => {
    const {toJSON} = render(
      <StartSessionModal visible={false} onClose={jest.fn()} onListenLive={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders SecurityCarousel when visible', () => {
    const {getByTestId} = render(
      <StartSessionModal visible onClose={jest.fn()} onListenLive={jest.fn()} />,
    );

    expect(getByTestId('security-carousel')).toBeTruthy();
  });

  // --- Scribe-only tenant ---
  it('shows only Start Scribe Mode button when only hasMicrophoneChatType is true', () => {
    const {getByText, queryByText} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        hasMicrophoneChatType
        hasDictationChatType={false}
      />,
    );

    expect(getByText('calls.dialog.startSession.startScribeMode')).toBeTruthy();
    expect(queryByText('calls.dialog.startSession.startDictationMode')).toBeNull();
  });

  // --- Dictation-only tenant ---
  it('shows only Start Dictation Mode button when only hasDictationChatType is true', () => {
    const {getByText, queryByText} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        hasMicrophoneChatType={false}
        hasDictationChatType
      />,
    );

    expect(getByText('calls.dialog.startSession.startDictationMode')).toBeTruthy();
    expect(queryByText('calls.dialog.startSession.startScribeMode')).toBeNull();
  });

  // --- Both enabled ---
  it('shows both buttons when both chat types are enabled', () => {
    const {getByText} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        hasMicrophoneChatType
        hasDictationChatType
      />,
    );

    expect(getByText('calls.dialog.startSession.startScribeMode')).toBeTruthy();
    expect(getByText('calls.dialog.startSession.startDictationMode')).toBeTruthy();
  });

  // --- Scribe flow ---
  it('calls onListenLive with "scribe" when Start Scribe Mode is confirmed', () => {
    const onClose = jest.fn();
    const onListenLive = jest.fn();
    const {getByText} = render(
      <StartSessionModal
        visible
        onClose={onClose}
        onListenLive={onListenLive}
        hasMicrophoneChatType
        hasDictationChatType={false}
      />,
    );

    fireEvent.press(getByText('calls.dialog.startSession.startScribeMode'));
    fireEvent.press(getByText('Start Session'));
    expect(onListenLive).toHaveBeenCalledWith('scribe');
    expect(onClose).toHaveBeenCalled();
  });

  // --- Dictation flow ---
  it('calls onListenLive with "dictation" when Start Dictation Mode is confirmed', () => {
    const onClose = jest.fn();
    const onListenLive = jest.fn();
    const {getByText} = render(
      <StartSessionModal
        visible
        onClose={onClose}
        onListenLive={onListenLive}
        hasMicrophoneChatType={false}
        hasDictationChatType
      />,
    );

    fireEvent.press(getByText('calls.dialog.startSession.startDictationMode'));
    fireEvent.press(getByText('Start Session'));
    expect(onListenLive).toHaveBeenCalledWith('dictation');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not fire onListenLive immediately when start button is pressed', () => {
    const onListenLive = jest.fn();
    const {getByText} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={onListenLive}
        hasMicrophoneChatType
      />,
    );

    fireEvent.press(getByText('calls.dialog.startSession.startScribeMode'));
    expect(onListenLive).not.toHaveBeenCalled();
  });

  it('closes notification modal when pressing outside (via onClose)', () => {
    const onListenLive = jest.fn();
    const {getByText, getByTestId} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={onListenLive}
        hasMicrophoneChatType
      />,
    );

    fireEvent.press(getByText('calls.dialog.startSession.startScribeMode'));
    expect(getByTestId('notification-modal')).toBeTruthy();
    expect(onListenLive).not.toHaveBeenCalled();
  });

  // --- Create Note (per-tenant toggle + counsellor permission, resolved by the parent) ---
  it('shows the Create Note button only when showCreateNote is true', () => {
    const {getByText, rerender, queryByText} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        showCreateNote
      />,
    );
    expect(getByText('calls.createNote.button')).toBeTruthy();

    rerender(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        showCreateNote={false}
      />,
    );
    expect(queryByText('calls.createNote.button')).toBeNull();
  });

  it('fires onCreateNote immediately (no consent modal — nothing is recorded)', () => {
    const onCreateNote = jest.fn();
    const {getByText, queryByTestId} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        showCreateNote
        onCreateNote={onCreateNote}
      />,
    );

    fireEvent.press(getByText('calls.createNote.button'));
    expect(onCreateNote).toHaveBeenCalled();
    expect(queryByTestId('notification-modal')).toBeNull();
  });
});

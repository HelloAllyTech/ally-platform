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
  it('shows Start Scribe Mode button when hasMicrophoneChatType is true', () => {
    const {getByText} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        hasMicrophoneChatType
      />,
    );

    expect(getByText('calls.dialog.startSession.startScribeMode')).toBeTruthy();
  });

  // --- Retired dictation mode ---
  it('never offers the retired Start Dictation Mode button', () => {
    const {queryByText} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        hasMicrophoneChatType
        showCreateNote
      />,
    );

    expect(
      queryByText('calls.dialog.startSession.startDictationMode'),
    ).toBeNull();
  });

  // --- Scribe flow ---
  it('calls onListenLive when Start Scribe Mode is confirmed', () => {
    const onClose = jest.fn();
    const onListenLive = jest.fn();
    const {getByText} = render(
      <StartSessionModal
        visible
        onClose={onClose}
        onListenLive={onListenLive}
        hasMicrophoneChatType
      />,
    );

    fireEvent.press(getByText('calls.dialog.startSession.startScribeMode'));
    fireEvent.press(getByText('Start Session'));
    expect(onListenLive).toHaveBeenCalled();
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

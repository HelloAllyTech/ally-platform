import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {StartSessionModal} from '@/screens/CallLog/components/StartSessionModal/StartSessionModal';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

jest.mock('@/assets', () => ({CloseIcon: () => null}));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Button: ({onPress, label, testID}: any) => (
      <Text testID={testID} onPress={onPress}>
        {label}
      </Text>
    ),
  };
});

const SCRIBE = 'calls.dialog.startSession.startScribeMode';
const DICTATION = 'calls.dialog.startSession.startDictationMode';

describe('StartSessionModal', () => {
  it('returns null when not visible', () => {
    const {toJSON} = render(
      <StartSessionModal
        visible={false}
        onClose={jest.fn()}
        onListenLive={jest.fn()}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('shows the consent line — this sheet is the consent gate', () => {
    const {getByTestId} = render(
      <StartSessionModal visible onClose={jest.fn()} onListenLive={jest.fn()} />,
    );

    expect(getByTestId('start-session-consent')).toBeTruthy();
  });

  it('offers scribe mode only when the tenant has microphone chat', () => {
    const {queryByText, rerender} = render(
      <StartSessionModal visible onClose={jest.fn()} onListenLive={jest.fn()} />,
    );
    expect(queryByText(SCRIBE)).toBeNull();

    rerender(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        hasMicrophoneChatType
      />,
    );
    expect(queryByText(SCRIBE)).toBeTruthy();
  });

  it('starts scribe on the first tap, with no second confirmation', () => {
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

    fireEvent.press(getByText(SCRIBE));

    // Previously this only opened a second dialog — and that dialog was the
    // roleplay pre-start warning about an unresponsive "bot", which has nothing
    // to do with scribe.
    expect(onListenLive).toHaveBeenCalledTimes(1);

    // The sheet MUST close itself here, synchronously. Holding it open until the
    // caller knew where it was going put its unmount in the same tick as
    // navigate(), which froze Android in 1.23.21. Closing first leaves the
    // permission await between the dismissal and the navigation.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers dictation mode only when the tenant toggle allows it', () => {
    const {queryByText, rerender} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        showCreateNote
      />,
    );
    expect(queryByText(DICTATION)).toBeTruthy();

    rerender(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        showCreateNote={false}
      />,
    );
    expect(queryByText(DICTATION)).toBeNull();
  });

  it('creates the dictation note immediately — nothing is recorded, so no consent step', () => {
    const onCreateNote = jest.fn();
    const {getByText} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        showCreateNote
        onCreateNote={onCreateNote}
      />,
    );

    fireEvent.press(getByText(DICTATION));

    expect(onCreateNote).toHaveBeenCalledTimes(1);
  });

  it('can offer both modes at once', () => {
    const {queryByText} = render(
      <StartSessionModal
        visible
        onClose={jest.fn()}
        onListenLive={jest.fn()}
        hasMicrophoneChatType
        showCreateNote
      />,
    );

    expect(queryByText(SCRIBE)).toBeTruthy();
    expect(queryByText(DICTATION)).toBeTruthy();
  });
});

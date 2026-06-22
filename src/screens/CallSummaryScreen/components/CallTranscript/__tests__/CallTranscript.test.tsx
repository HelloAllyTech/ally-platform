import React from 'react';
import {render} from '@testing-library/react-native';
import {ActivityIndicator, FlatList, Text} from 'react-native';

import {CallTranscript} from '../CallTranscript';

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    EmptyTranscript: () => <Text>empty</Text>,
    // Expose both label and message so we can assert translation-driven labels
    TranscriptItem: ({message, speakerLabel}: any) => (
      <Text>
        {speakerLabel ? `${speakerLabel}: ` : ''}
        {message}
      </Text>
    ),
  };
});

let mockHookState: any = {
  formattedMessages: [],
  isLoading: false,
  listRef: {current: null},
  handleEndReached: jest.fn(),
};

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
  useCallTranscriptDetails: () => mockHookState,
}));

describe('CallSummaryScreen/CallTranscript', () => {
  it('renders empty transcript when no messages', () => {
    const {getByText} = render(<CallTranscript chatId={1} />);
    expect(getByText('empty')).toBeTruthy();
  });

  it('renders messages with proper speaker labels', () => {
    mockHookState = {
      formattedMessages: [
        {id: 1, message: 'Hello', time: '10:00', counselor: true, client: false},
        {id: 2, message: 'Hi', time: '10:01', counselor: false, client: true},
      ],
      isLoading: false,
      listRef: {current: null},
      handleEndReached: jest.fn(),
    };

    const {getByText} = render(<CallTranscript chatId={1} />);

    expect(getByText('transcription.youLabel')).toBeTruthy();
    expect(getByText('transcription.clientLabel')).toBeTruthy();
  });

  it('shows footer loader when isLoading=true', () => {
    mockHookState = {
      formattedMessages: [],
      isLoading: true,
      listRef: {current: null},
      handleEndReached: jest.fn(),
    };
    const {UNSAFE_getAllByType} = render(<CallTranscript chatId={2} />);
    expect(UNSAFE_getAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it('calls onEndReached handler from list', () => {
    const onEnd = jest.fn();
    mockHookState = {
      formattedMessages: [],
      isLoading: false,
      listRef: {current: null},
      handleEndReached: onEnd,
    };
    const {UNSAFE_getByType} = render(<CallTranscript chatId={3} />);
    const list = UNSAFE_getByType(FlatList);
    list.props.onEndReached();
    expect(onEnd).toHaveBeenCalled();
  });
  it('renders continuous text when isDictationMode=true', () => {
    mockHookState = {
      formattedMessages: [
        {id: 1, message: 'Hello', time: '10:00', counselor: true, client: false},
        {id: 2, message: 'world', time: '10:01', counselor: false, client: true},
      ],
      isLoading: false,
      listRef: {current: null},
      handleEndReached: jest.fn(),
      summaryData: {details: {callInfo: {mode: 'DICTATION'}}},
    };

    const {getByText, queryByTestId} = render(<CallTranscript chatId={1} />);

    // In dictation mode, we join messages: 'Hello world'
    expect(getByText('Hello world')).toBeTruthy();
    // FlatList should not be rendered
    expect(queryByTestId('transcript-list')).toBeNull();
  });
});



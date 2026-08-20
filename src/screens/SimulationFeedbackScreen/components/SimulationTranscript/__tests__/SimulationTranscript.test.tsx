import React from 'react';
import {render, waitFor} from '@testing-library/react-native';

const mockScrollToIndex = jest.fn();
// The real FlatList is a forwardRef component: passing `ref={listRef}` (a
// plain object, not a useRef()) lets React set `listRef.current` to the real
// instance on mount — clobbering the hook's stubbed `scrollToIndex` before
// the moment-focus effect below ever runs. Stub just the FlatList submodule
// (not all of 'react-native', which would pull in real native modules) so the
// ref keeps pointing at a spy we control, and map data through renderItem.
jest.mock('react-native/Libraries/Lists/FlatList', () => {
  const ReactActual = require('react');
  const {View} = require('react-native');
  const MockFlatList = ReactActual.forwardRef((props: any, ref: any) => {
    const {data, renderItem, ListEmptyComponent, ListFooterComponent} = props;
    ReactActual.useImperativeHandle(ref, () => ({
      scrollToIndex: mockScrollToIndex,
    }));
    if (!data || data.length === 0) {
      return ListEmptyComponent
        ? ReactActual.createElement(ListEmptyComponent)
        : null;
    }
    return ReactActual.createElement(
      View,
      null,
      data.map((item: unknown, index: number) =>
        ReactActual.createElement(
          View,
          {key: index},
          renderItem({item, index}),
        ),
      ),
      ListFooterComponent ?? null,
    );
  });
  return {__esModule: true, default: MockFlatList};
});

jest.mock('../../SimulationAudioPlayer/SimulationAudioPlayer', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    SimulationAudioPlayer: () => <View testID="simulation-audio-player" />,
  };
});

import {SimulationTranscript} from '../SimulationTranscript';

// Avoid importing NetworkLogs through components barrel
jest.mock('@/components/EmptyTranscript/EmptyTranscript', () => ({
  EmptyTranscript: () => null,
}));

const mockShowToast = jest.fn();
jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    useErrorToast: () => ({showErrorToast: jest.fn()}),
    useToast: () => ({showToast: mockShowToast}),
    CustomDropdown: () => <View testID="language-dropdown" />,
  };
});

jest.mock('@/store/hooks', () => ({
  useAppSelector: jest.fn().mockImplementation(selector =>
    selector({
      user: {
        user: {
          name: 'Test User',
        },
      },
    }),
  ),
}));

const defaultMessages = [
  {id: 1, time: '00:01', message: 'Hello', learner: true, startSeconds: 1},
  {id: 2, time: '00:02', message: 'Hi', learner: false, startSeconds: 2},
  {id: 3, time: '00:03', message: 'Test', learner: true, startSeconds: 3},
  {id: 4, time: '00:04', message: 'Test2', learner: false, startSeconds: 4},
  {id: 5, time: '00:05', message: 'Test3', learner: true, startSeconds: 5},
  {id: 6, time: '00:06', message: 'Test4', learner: false, startSeconds: 6},
];

const mockHandleEndReached = jest.fn();
const mockUseSimulationTranscriptDetails = jest.fn((..._args: unknown[]) => ({
  formattedMessages: defaultMessages,
  isLoading: true,
  isFetching: false,
  isError: false,
  error: undefined,
  hasMore: false,
  listRef: {current: {scrollToIndex: mockScrollToIndex}},
  handleEndReached: mockHandleEndReached,
}));
jest.mock('@/hooks/useSimulationTranscriptDetails', () => ({
  useSimulationTranscriptDetails: (...args: unknown[]) =>
    mockUseSimulationTranscriptDetails(...args),
}));

jest.mock('@/hooks/useTranslate', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  }),
}));

describe('SimulationTranscript', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSimulationTranscriptDetails.mockReturnValue({
      formattedMessages: defaultMessages,
      isLoading: true,
      isFetching: false,
      isError: false,
      error: undefined,
      hasMore: false,
      listRef: {current: {scrollToIndex: mockScrollToIndex}},
      handleEndReached: mockHandleEndReached,
    });
  });

  it('renders transcript items and loading footer', () => {
    const {getByText, getByTestId} = render(
      <SimulationTranscript
        sessionId="1"
        startedAt="2024-01-01T00:00:00Z"
        audioUrl="https://example.com/recording.ogg"
      />,
    );
    expect(getByText('Hello')).toBeTruthy();
    expect(getByText('Hi')).toBeTruthy();
    expect(getByTestId('simulation-audio-player')).toBeTruthy();
  });

  it('shows message when no recording URL', () => {
    const {getByText, queryByTestId} = render(
      <SimulationTranscript sessionId="1" startedAt="2024-01-01T00:00:00Z" />,
    );
    expect(
      getByText('postSim.noSessionRecording'),
    ).toBeTruthy();
    expect(queryByTestId('simulation-audio-player')).toBeNull();
  });

  describe('moment focus (debrief note chip)', () => {
    it('scrolls to a message already in the loaded page', async () => {
      render(
        <SimulationTranscript
          sessionId="1"
          startedAt="2024-01-01T00:00:00Z"
          focusMessage={{messageId: '3', requestId: 1}}
        />,
      );

      await waitFor(() => {
        expect(mockScrollToIndex).toHaveBeenCalledWith(
          expect.objectContaining({index: 2}),
        );
      });
      expect(mockHandleEndReached).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('chases pagination when the moment is not yet loaded', async () => {
      mockUseSimulationTranscriptDetails.mockReturnValue({
        formattedMessages: defaultMessages,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: undefined,
        hasMore: true,
        listRef: {current: {scrollToIndex: mockScrollToIndex}},
        handleEndReached: mockHandleEndReached,
      });

      render(
        <SimulationTranscript
          sessionId="1"
          startedAt="2024-01-01T00:00:00Z"
          // Not in defaultMessages (ids 1-6): the transcript must page further.
          focusMessage={{messageId: '42', requestId: 1}}
        />,
      );

      await waitFor(() => {
        expect(mockHandleEndReached).toHaveBeenCalled();
      });
      expect(mockScrollToIndex).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('tells the learner when every page is loaded and the moment never turns up', async () => {
      mockUseSimulationTranscriptDetails.mockReturnValue({
        formattedMessages: defaultMessages,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: undefined,
        hasMore: false,
        listRef: {current: {scrollToIndex: mockScrollToIndex}},
        handleEndReached: mockHandleEndReached,
      });

      render(
        <SimulationTranscript
          sessionId="1"
          startedAt="2024-01-01T00:00:00Z"
          focusMessage={{messageId: '42', requestId: 1}}
        />,
      );

      // Ally only anchors moments it could resolve, so landing here means the
      // id is outside what this session loaded — say the jump didn't land
      // rather than leaving the transcript sitting at the top silently.
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          expect.stringContaining('momentNotFound'),
          'error',
        );
      });
      expect(mockScrollToIndex).not.toHaveBeenCalled();
    });

    it('does not re-resolve the same request twice', async () => {
      const {rerender} = render(
        <SimulationTranscript
          sessionId="1"
          startedAt="2024-01-01T00:00:00Z"
          focusMessage={{messageId: '3', requestId: 1}}
        />,
      );

      await waitFor(() => {
        expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
      });

      rerender(
        <SimulationTranscript
          sessionId="1"
          startedAt="2024-01-01T00:00:00Z"
          focusMessage={{messageId: '3', requestId: 1}}
        />,
      );

      expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
    });
  });
});



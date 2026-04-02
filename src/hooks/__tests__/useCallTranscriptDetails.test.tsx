// tests/useCallTranscriptDetails.test.tsx
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';

import { useCallTranscriptDetails } from '../useCallTranscriptDetails';

// create stable mocks outside the factory so they don't get recreated each render
const mockGetChatMessages = jest.fn();
const baseNow = Date.now();
const mockLazyQueryResult = {
  isLoading: false,
  isFetching: false,
  data: {
    data: [
      {
        messageId: 'm1',
        content: 'hello',
        senderId: 1,
        startSeconds: 1,
        createdAt: new Date(baseNow + 1000).toISOString(),
      },
      {
        messageId: 'm2',
        content: 'world',
        senderId: -1,
        startSeconds: 2,
        createdAt: new Date(baseNow + 2000).toISOString(),
      },
    ],
    count: 2,
  },
};

// stable summaryData object
let mockSummaryData: any = {
  counselorId: 1,
  clientId: 2,
  createdAt: new Date(baseNow).toISOString(),
  details: { callInfo: { provider: undefined } },
};

jest.mock('@/services/callTranscriptApi', () => ({
  // return the same function & object each call
  useLazyGetChatMessagesQuery: () => [mockGetChatMessages, mockLazyQueryResult],
}));

jest.mock('@/store/hooks', () => ({
  // return stable summaryData (or use jest.fn().mockReturnValue)
  useAppSelector: () => mockSummaryData,
}));

const Test = ({chatId}: {chatId: number}) => {
  const { formattedMessages, hasMore, handleEndReached } = useCallTranscriptDetails(chatId as any);
  return (
    <>
      <Text testID="count">{String(formattedMessages.length)}</Text>
      <Text testID="hasMore">{String(hasMore)}</Text>
      <Text testID="time0">{formattedMessages[0]?.time ?? ''}</Text>
      <Text testID="time1">{formattedMessages[1]?.time ?? ''}</Text>
      <Text testID="end" onPress={() => handleEndReached()} />
    </>
  );
};

describe('useCallTranscriptDetails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSummaryData = {
      counselorId: 1,
      clientId: 2,
      createdAt: new Date(baseNow).toISOString(),
      details: { callInfo: { provider: undefined } },
    };
  });

  it('loads and formats messages and sets hasMore=false when all loaded', async () => {
    const { getByTestId } = render(<Test chatId={0} />);
    await waitFor(() => expect(getByTestId('count').props.children).toBe('2'));
    await waitFor(() => {
      expect(getByTestId('hasMore').props.children).toBe('false');
      // For non-WEBRTC provider, times use startSeconds => formatTimeToMMSS(startSeconds * 1000)
      expect(getByTestId('time0').props.children).toBe('00:01');
      expect(getByTestId('time1').props.children).toBe('00:02');
    });
  });

  it('requests messages sorted by createdAt when provider is WEBRTC', async () => {
    mockSummaryData = {
      ...mockSummaryData,
      details: { callInfo: { provider: 'WEBRTC' } },
    };
    render(<Test chatId={1} />);
    await waitFor(() => expect(mockGetChatMessages).toHaveBeenCalled());
    expect(mockGetChatMessages).toHaveBeenCalledWith(expect.objectContaining({sortBy: 'createdAt'}));
  });

  it('calls handleEndReached and fetches next page when hasMore and not loading', async () => {
    // set hasMore true by increasing count so effect won't set it false
    (mockLazyQueryResult as any).data.count = 100;
    const { getByTestId } = render(<Test chatId={2} />);
    await waitFor(() => expect(getByTestId('hasMore').props.children).toBe('true'));
    await act(async () => {
      getByTestId('end').props.onPress();
    });
    expect(mockGetChatMessages).toHaveBeenCalled();
    // reset
    (mockLazyQueryResult as any).data.count = 2;
  });
});

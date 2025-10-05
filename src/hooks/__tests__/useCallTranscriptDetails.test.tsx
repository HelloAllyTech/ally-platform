// tests/useCallTranscriptDetails.test.tsx
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

import { useCallTranscriptDetails } from '../useCallTranscriptDetails';

// create stable mocks outside the factory so they don't get recreated each render
const mockGetChatMessages = jest.fn();
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
        createdAt: new Date().toISOString(),
      },
      {
        messageId: 'm2',
        content: 'world',
        senderId: -1,
        startSeconds: 2,
        createdAt: new Date().toISOString(),
      },
    ],
    count: 2,
  },
};

// stable summaryData object
const mockSummaryData = {
  counselorId: 1,
  clientId: 2,
  createdAt: new Date().toISOString(),
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

const Test = () => {
  const { formattedMessages, hasMore } = useCallTranscriptDetails(0 as any);
  return (
    <>
      <Text testID="count">{String(formattedMessages.length)}</Text>
      <Text testID="hasMore">{String(hasMore)}</Text>
    </>
  );
};

describe('useCallTranscriptDetails', () => {
  it('loads and formats messages and sets hasMore=false when all loaded', async () => {
    const { getByTestId } = render(<Test />);
    await waitFor(
      () => {
        expect(getByTestId('count').props.children).toBe('2');
        expect(getByTestId('hasMore').props.children).toBe('false');
      },
      {timeout: 3000},
    );
  });
});

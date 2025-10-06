// __tests__/useSimulationTranscriptDetails.test.tsx
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

import { useSimulationTranscriptDetails } from '../useSimulationTranscriptDetails';

// stable mocks created once
const mockGetMessages = jest.fn();

const mockNowIso = new Date().toISOString();

const mockLazyQueryResult = {
  isLoading: false,
  isFetching: false,
  data: {
    messages: [
      {
        id: '1',
        content: 'a',
        senderId: 1,
        startSeconds: 0,
        createdAt: mockNowIso,
      },
      {
        id: '2',
        content: 'b',
        senderId: -1,
        startSeconds: 2,
        createdAt: mockNowIso,
      },
    ],
    count: 2,
  },
};

jest.mock('@/services/simulationTranscriptApi', () => ({
  // return stable references so the hook doesn't think getMessages changed every render
  useLazyGetSimulationMessagesQuery: () => [mockGetMessages, mockLazyQueryResult],
}));

const Test = () => {
  // pass falsy id to avoid reset/useLazy fetch effect from clearing initial data
  const { formattedMessages, hasMore } = useSimulationTranscriptDetails(0 as any, mockNowIso);
  return (
    <>
      <Text testID="count">{String(formattedMessages.length)}</Text>
      <Text testID="hasMore">{String(hasMore)}</Text>
    </>
  );
};

describe('useSimulationTranscriptDetails', () => {
  it('loads and formats simulation messages and sets hasMore=false when all loaded', async () => {
    const { getByTestId } = render(<Test />);
    await waitFor(
      () => {
        expect(getByTestId('count').props.children).toBe('2');
        expect(getByTestId('hasMore').props.children).toBe('false');
      },
      { timeout: 3000 }
    );
  });
});

// __tests__/useSimulationTranscriptDetails.test.tsx
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

import { useSimulationTranscriptDetails } from '../useSimulationTranscriptDetails';

const mockNowIso = new Date().toISOString();

const mockMessagesResult = {
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
};

// trigger() returns a promise-like with .unwrap(), matching RTK Query's lazy query API
const mockGetMessages = jest.fn(() => ({
  unwrap: () => Promise.resolve(mockMessagesResult),
}));

jest.mock('@/services/simulationTranscriptApi', () => ({
  useLazyGetSimulationMessagesQuery: () => [
    mockGetMessages,
    { data: undefined, isLoading: false, isFetching: false },
  ],
}));

const Test = () => {
  const { formattedMessages, hasMore } = useSimulationTranscriptDetails(
    'session-1',
    mockNowIso,
  );
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
      { timeout: 3000 },
    );
  });

  it('repopulates messages when switching back to a language RTK Query already has cached (same data reference)', async () => {
    // Simulates RTK Query returning the identical cached object on a cache hit —
    // the hook must not rely on that reference changing to know a new page arrived.
    const cachedResult = mockMessagesResult;
    const getMessages = jest.fn(() => ({
      unwrap: () => Promise.resolve(cachedResult),
    }));

    const LanguageTest = ({ languageCode }: { languageCode: string }) => {
      const { formattedMessages } = useSimulationTranscriptDetails(
        'session-1',
        mockNowIso,
        languageCode,
      );
      return <Text testID="count">{String(formattedMessages.length)}</Text>;
    };

    jest.requireMock(
      '@/services/simulationTranscriptApi',
    ).useLazyGetSimulationMessagesQuery = () => [
      getMessages,
      { data: undefined, isLoading: false, isFetching: false },
    ];

    const { getByTestId, rerender } = render(
      <LanguageTest languageCode="hi" />,
    );
    await waitFor(() => expect(getByTestId('count').props.children).toBe('2'));

    rerender(<LanguageTest languageCode="en" />);
    await waitFor(() => expect(getByTestId('count').props.children).toBe('2'));

    // Switch back to the already-fetched language — same cached reference is returned
    rerender(<LanguageTest languageCode="hi" />);
    await waitFor(() => expect(getByTestId('count').props.children).toBe('2'));
  });

  it('does not duplicate a page when onEndReached fires twice before state flushes', async () => {
    const page1 = {
      messages: [
        { id: '1', content: 'a', senderId: 1, startSeconds: 0, createdAt: mockNowIso },
      ],
      count: 3,
    };
    const page2 = {
      messages: [
        { id: '2', content: 'b', senderId: -1, startSeconds: 1, createdAt: mockNowIso },
        { id: '3', content: 'c', senderId: 1, startSeconds: 2, createdAt: mockNowIso },
      ],
      count: 3,
    };
    const getMessages = jest
      .fn()
      .mockReturnValueOnce({ unwrap: () => Promise.resolve(page1) })
      .mockReturnValue({ unwrap: () => Promise.resolve(page2) });

    jest.requireMock(
      '@/services/simulationTranscriptApi',
    ).useLazyGetSimulationMessagesQuery = () => [
      getMessages,
      { data: undefined, isLoading: false, isFetching: false },
    ];

    let handleEndReached: () => void = () => {};
    const PagingTest = () => {
      const hook = useSimulationTranscriptDetails('session-1', mockNowIso);
      handleEndReached = hook.handleEndReached;
      return <Text testID="count">{String(hook.formattedMessages.length)}</Text>;
    };

    const { getByTestId } = render(<PagingTest />);
    await waitFor(() => expect(getByTestId('count').props.children).toBe('1'));

    // Simulate FlatList firing onEndReached twice back-to-back before the
    // paging lock / offset state has a chance to flush.
    handleEndReached();
    handleEndReached();

    await waitFor(() => expect(getByTestId('count').props.children).toBe('3'));
    // Only the initial fetch + a single page-2 fetch should have happened.
    expect(getMessages).toHaveBeenCalledTimes(2);
  });

  it('retries the same page instead of skipping it when a fetch fails', async () => {
    const page1 = {
      messages: [
        { id: '1', content: 'a', senderId: 1, startSeconds: 0, createdAt: mockNowIso },
      ],
      count: 2,
    };
    const page2 = {
      messages: [
        { id: '2', content: 'b', senderId: -1, startSeconds: 1, createdAt: mockNowIso },
      ],
      count: 2,
    };
    const getMessages = jest
      .fn()
      .mockReturnValueOnce({ unwrap: () => Promise.resolve(page1) })
      // First attempt at page 2 fails.
      .mockReturnValueOnce({ unwrap: () => Promise.reject(new Error('network')) })
      // Retry of page 2 (same offset) succeeds.
      .mockReturnValueOnce({ unwrap: () => Promise.resolve(page2) });

    jest.requireMock(
      '@/services/simulationTranscriptApi',
    ).useLazyGetSimulationMessagesQuery = () => [
      getMessages,
      { data: undefined, isLoading: false, isFetching: false },
    ];

    let handleEndReached: () => void = () => {};
    const PagingTest = () => {
      const hook = useSimulationTranscriptDetails('session-1', mockNowIso);
      handleEndReached = hook.handleEndReached;
      return <Text testID="count">{String(hook.formattedMessages.length)}</Text>;
    };

    const { getByTestId } = render(<PagingTest />);
    await waitFor(() => expect(getByTestId('count').props.children).toBe('1'));

    handleEndReached();
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2));

    // Failed fetch must not have advanced past page 2 — retrying reaches the
    // same offset rather than jumping straight to a page-3 request.
    handleEndReached();
    await waitFor(() => expect(getByTestId('count').props.children).toBe('2'));
    expect(getMessages).toHaveBeenCalledTimes(3);
    expect(getMessages.mock.calls[1][0].offset).toBe(getMessages.mock.calls[2][0].offset);
  });

  it('keeps existing messages visible when a language-switch fetch fails', async () => {
    const initialResult = {
      messages: [
        { id: '1', content: 'a', senderId: 1, startSeconds: 0, createdAt: mockNowIso },
      ],
      count: 1,
    };
    const getMessages = jest
      .fn()
      .mockReturnValueOnce({ unwrap: () => Promise.resolve(initialResult) })
      .mockReturnValueOnce({
        unwrap: () => Promise.reject(new Error('unsupported language')),
      });

    jest.requireMock(
      '@/services/simulationTranscriptApi',
    ).useLazyGetSimulationMessagesQuery = () => [
      getMessages,
      { data: undefined, isLoading: false, isFetching: false },
    ];

    const LanguageTest = ({ languageCode }: { languageCode: string }) => {
      const { formattedMessages } = useSimulationTranscriptDetails(
        'session-1',
        mockNowIso,
        languageCode,
      );
      return <Text testID="count">{String(formattedMessages.length)}</Text>;
    };

    const { getByTestId, rerender } = render(<LanguageTest languageCode="en" />);
    await waitFor(() => expect(getByTestId('count').props.children).toBe('1'));

    rerender(<LanguageTest languageCode="hi" />);
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2));

    // The failed translation fetch must not blank out the already-loaded transcript.
    expect(getByTestId('count').props.children).toBe('1');
  });
});

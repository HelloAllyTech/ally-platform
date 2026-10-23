import React from 'react';
import {Text} from 'react-native';
import {act, render, waitFor} from '@testing-library/react-native';

import {useSummaryState} from '../useSummaryState';

jest.mock('@/services/callSummaryApi', () => ({
  useLazyGetCallSummaryQuery: () => [
    jest.fn(async () => ({data: {details: {summary: {content: 'ok'}}, summaryStatus: 'READY'}})),
    {isLoading: false, data: {details: {summary: {content: 'ok'}}, summaryStatus: 'READY'}},
  ],
}));

jest.mock('@/services/chatApi', () => ({
  useUpdateNotesMutation: () => [jest.fn(async () => ({}))],
}));

jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
}));

jest.mock('@/store/slices/summarySlice', () => ({
  clearSummaryStates: jest.fn(() => ({type: 'clear'})),
}));

jest.useFakeTimers();

const Test = ({chatId = 1, callId = 1}: {chatId?: number; callId?: number}) => {
  const state = useSummaryState(chatId, callId);
  return (
    <>
      <Text testID="isSummaryAvailable">{String(state.isSummaryAvailable)}</Text>
      <Text testID="canShowSummary">{String(state.canShowSummary)}</Text>
      <Text testID="summaryStatus">{String(state.summaryStatus)}</Text>
    </>
  );
};

describe('useSummaryState', () => {
  it('loads summary and flips canShowSummary after delay when available', async () => {
    const {getByTestId} = render(<Test />);

    await waitFor(() => {
      expect(getByTestId('isSummaryAvailable').props.children).toBe('true');
      expect(getByTestId('canShowSummary').props.children).toBe('true');
      expect(getByTestId('summaryStatus').props.children).toBe('READY');
    });

    // If we simulate case where canShowSummary is initially false
    const {getByTestId: getByTestId2, rerender} = render(<Test callId={undefined as any} />);
    // Advance timer to trigger delayed show
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    await waitFor(() => {
      expect(getByTestId2('canShowSummary').props.children).toBe('true');
    });
  });
});



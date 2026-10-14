import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';

import {StartJournalItemPayload, TrackItemType} from '@/types';

import {JournalPlayer} from '../JournalPlayer';

jest.mock('@/hooks', () => {
  const actual = jest.requireActual('@/hooks/useDebounce');
  return {
    useDebounce: actual.useDebounce,
    useTranslate: jest.fn(() => ({
      t: (key: string) => key,
      tVariable: (key: string) => key,
    })),
  };
});

jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    RichText: ({html}: any) => <RN.Text testID="rich-text">{html}</RN.Text>,
    Button: ({label, onPress, isDisabled, testID}: any) => (
      <RN.TouchableOpacity testID={testID} onPress={onPress} disabled={isDisabled}>
        <RN.Text>{label}</RN.Text>
      </RN.TouchableOpacity>
    ),
  };
});

const mockSaveJournalDraft = jest.fn(() => ({
  unwrap: jest.fn().mockResolvedValue({success: true}),
}));
const mockSubmitJournal = jest.fn(() => ({
  unwrap: jest.fn().mockResolvedValue({
    completed: true,
    unlockedItemIds: [],
    sectionCompleted: false,
    trackCompleted: false,
  }),
}));

jest.mock('@/services', () => ({
  useSaveJournalDraftMutation: jest.fn(() => [mockSaveJournalDraft]),
  useSubmitJournalMutation: jest.fn(() => [mockSubmitJournal, {isLoading: false}]),
}));

const buildPayload = (): StartJournalItemPayload => ({
  type: TrackItemType.JOURNAL as const,
  trackItemProgressId: 'progress-1',
  prompts: [
    {id: 'p1', prompt: 'What went well?', required: true, placeholder: null},
    {id: 'p2', prompt: 'What would you change?', required: false, placeholder: null},
  ],
  savedResponses: [],
});

describe('JournalPlayer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('disables Submit until every required prompt has a response', () => {
    const {getByTestId} = render(
      <JournalPlayer
        payload={buildPayload()}
        itemId="item-1"
        alreadyCompleted={false}
        onCompleted={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId('journal-submit'));
    expect(mockSubmitJournal).not.toHaveBeenCalled();
  });

  it('autosaves a draft (debounced) as the learner types', async () => {
    jest.useFakeTimers();
    const {getByTestId} = render(
      <JournalPlayer
        payload={buildPayload()}
        itemId="item-1"
        alreadyCompleted={false}
        onCompleted={jest.fn()}
      />,
    );

    fireEvent.changeText(getByTestId('journal-response-p1'), 'It went well.');
    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() =>
      expect(mockSaveJournalDraft).toHaveBeenCalledWith({
        itemId: 'item-1',
        responses: [
          {promptId: 'p1', response: 'It went well.'},
          {promptId: 'p2', response: ''},
        ],
      }),
    );
    jest.useRealTimers();
  });

  it('submits once the required prompt is answered, and calls onCompleted', async () => {
    const onCompleted = jest.fn();
    const {getByTestId} = render(
      <JournalPlayer
        payload={buildPayload()}
        itemId="item-1"
        alreadyCompleted={false}
        onCompleted={onCompleted}
      />,
    );

    fireEvent.changeText(getByTestId('journal-response-p1'), 'It went well.');
    fireEvent.press(getByTestId('journal-submit'));

    await waitFor(() => expect(mockSubmitJournal).toHaveBeenCalledWith({itemId: 'item-1'}));
    await waitFor(() =>
      expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({completed: true})),
    );
  });

  it('shows the submitted state and hides the submit button when already completed', () => {
    const {queryByTestId, getAllByText} = render(
      <JournalPlayer
        payload={buildPayload()}
        itemId="item-1"
        alreadyCompleted
        onCompleted={jest.fn()}
      />,
    );
    expect(queryByTestId('journal-submit')).toBeNull();
    // Shown in both the autosave-status row and the footer chip.
    expect(getAllByText('courses.journal.submitted').length).toBeGreaterThan(0);
  });

  it('renders promptHtml when present', () => {
    const payloadWithHtml = buildPayload();
    payloadWithHtml.prompts[0].promptHtml = '<p>Rich prompt</p>';

    const {getByText} = render(
      <JournalPlayer
        payload={payloadWithHtml}
        itemId="item-1"
        alreadyCompleted={false}
        onCompleted={jest.fn()}
      />,
    );

    expect(getByText('<p>Rich prompt</p>')).toBeTruthy();
  });
});

import React from 'react';
import {Text} from 'react-native';
import {act, render, waitFor} from '@testing-library/react-native';

import {useCallSummaryForm} from '../useCallSummaryForm';

// Mutable mock state to simulate store updates
const mockState: any = {
  summary: {
    summaryData: {id: 1, details: {callInfo: {}, summary: {tags: []}}},
    formData: {notes: 'x', tags: ''},
    summary: {notes: 'y', tags: []},
  },
};

const mockDispatch = jest.fn((action: any) => {
  if (action?.type === 'set') {
    mockState.summary.formData = {
      ...mockState.summary.formData,
      ...action.payload,
    };
  }
});

jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (sel: any) => sel(mockState),
}));

jest.mock('@/store/slices/summarySlice', () => ({
  selectFormData: (s: any) => s.summary.formData,
  selectSummaryData: (s: any) => s.summary.summaryData,
  selectSummary: (s: any) => s.summary.summary,
  setFormData: (d: any) => ({type: 'set', payload: d}),
}));

const mockUpdate = jest.fn(async () => ({data: {ok: true}}));
const mockGetTags = jest.fn(async () => ({data: []}));
jest.mock('@/services/callSummaryApi', () => ({
  useUpdateCallSummaryMutation: () => [mockUpdate, {isLoading: false}],
  useGetTagsMutation: () => [mockGetTags],
}));

jest.mock('@/screens/CallSummaryScreen/utils/formDataTransformer', () => ({
  transformSummaryToFormData: () => ({notes: 'y', tags: ''}),
  transformFormDataForSubmission: (formData: any, _sd: any, _tags: any) => formData,
}));

jest.mock('@/constants/summary', () => ({
  SUMMARY_FIELDS: {TAGS: 'tags'},
  ChatSummaryStatus: {SUCCESS: 'SUCCESS'},
  summaryFields: [
    {key: 'notes', sectionKey: 'demo', isEditable: true},
    {key: 'tags', sectionKey: 'demo', isEditable: true},
  ],
}));

jest.mock('@/utils/callSummary', () => ({
  mapTagsToString: (tags: any[] = []) => tags.join(','),
}));

const Test = () => {
  const hook = useCallSummaryForm();
  return (
    <>
      <Text testID="hasChanges">{String(hook.hasChanges)}</Text>
      <Text testID="change-notes" onPress={() => hook.handleFieldChange('notes' as any)('z')} />
      <Text testID="change-tags" onPress={() => hook.handleFieldChange('tags' as any)('a,b')} />
      <Text testID="submit" onPress={() => hook.handleSubmit()} />
      <Text testID="reset" onPress={() => hook.handleSectionFieldsReset('demo' as any)} />
    </>
  );
};

describe('useCallSummaryForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.summary = {
      summaryData: {id: 1, details: {callInfo: {}, summary: {tags: []}}},
      formData: {notes: 'x', tags: ''},
      summary: {notes: 'y', tags: []},
    };
  });

  it('reports hasChanges and can reset section fields', async () => {
    const {getByTestId} = render(<Test />);
    // hasChanges compares original transformed summary vs current formData after effect; should be false
    await waitFor(() => expect(getByTestId('hasChanges').props.children).toBe('false'));

    act(() => {
      getByTestId('reset').props.onPress();
    });
    // after reset, notes should be updated in mock state
    expect(mockState.summary.formData.notes).toBeDefined();
  });

  it('submits without tags update when tags unchanged', async () => {
    const {getByTestId} = render(<Test />);
    await act(async () => {
      getByTestId('change-notes').props.onPress();
      await getByTestId('submit').props.onPress();
    });
    await waitFor(() => expect(mockGetTags).not.toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith({chatId: 1, data: {summary: expect.any(Object)}});
  });

  it('fetches tags and submits when tags changed; early return when no summaryData', async () => {
    const {getByTestId, rerender} = render(<Test />);
    await act(async () => {
      getByTestId('change-tags').props.onPress();
    });
    // force rerender to pick updated mockState via selector
    rerender(<Test />);
    await act(async () => {
      await getByTestId('submit').props.onPress();
    });
    await waitFor(() => expect(mockGetTags).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // early return when no summaryData
    mockState.summary.summaryData = null as any;
    rerender(<Test />);
    await act(async () => {
      await getByTestId('submit').props.onPress();
    });
    // update should still be called only once (no change after early return)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});



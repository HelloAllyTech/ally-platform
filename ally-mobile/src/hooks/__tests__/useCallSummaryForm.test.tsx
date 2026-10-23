import React from 'react';
import {Text} from 'react-native';
import {act, render, waitFor} from '@testing-library/react-native';

import {useCallSummaryForm} from '../useCallSummaryForm';

// Mutable mock state to simulate store updates
const mockState: any = {
  summary: {
    summaryData: {id: 1, details: {callInfo: {}, summary: {tags: []}}},
    // Matches what the seeding effect writes, so the first render represents a
    // freshly-seeded form. (This mock store has no subscription, so a dispatch
    // does not re-render on its own the way react-redux would.)
    formData: {notes: 'y', tags: ''},
    savedFormData: {notes: 'y', tags: ''},
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
  if (action?.type === 'saved') {
    mockState.summary.savedFormData = {
      ...mockState.summary.savedFormData,
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
  selectSavedFormData: (s: any) => s.summary.savedFormData,
  selectSummaryData: (s: any) => s.summary.summaryData,
  selectSummary: (s: any) => s.summary.summary,
  setFormData: (d: any) => ({type: 'set', payload: d}),
  markFormDataSaved: (d: any) => ({type: 'saved', payload: d}),
}));

const mockUpdate = jest.fn(async () => ({data: {ok: true}}));
// Kept only so the test can assert nothing reaches it any more: rating used to
// run inline before the write.
const mockGetTags = jest.fn(async () => ({data: []}));
jest.mock('@/services/callSummaryApi', () => ({
  useUpdateCallSummaryMutation: () => [mockUpdate, {isLoading: false}],
  useGetTagsMutation: () => [mockGetTags],
}));

// Real behaviour, reimplemented here so the hook's use of it is exercised
// without pulling the transformer's own dependency chain into this suite.
jest.mock('@/screens/CallSummaryScreen/utils/formDataTransformer', () => ({
  transformSummaryToFormData: () => ({notes: 'y', tags: ''}),
  getChangedSummaryFieldKeys: (baseline: any, current: any) =>
    !baseline || !current
      ? []
      : Object.keys(current).filter(key => baseline[key] !== current[key]),
  transformFormDataForSubmission: (
    formData: any,
    changedKeys: string[],
    tagNames?: string[],
  ) => {
    const patch: any = {};
    for (const key of changedKeys) {
      if (key === 'tags') {
        if (tagNames) patch.tags = tagNames;
        continue;
      }
      patch[key] = formData?.[key] ?? null;
    }
    return patch;
  },
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
      formData: {notes: 'y', tags: ''},
      savedFormData: {notes: 'y', tags: ''},
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

  it('sends only the field the counsellor edited', async () => {
    const {getByTestId, rerender} = render(<Test />);
    await act(async () => {
      getByTestId('change-notes').props.onPress();
    });
    rerender(<Test />);
    await act(async () => {
      await getByTestId('submit').props.onPress();
    });

    // Not the whole summary: an untouched field must not be written back, or a
    // value added since this screen loaded would be reverted.
    expect(mockUpdate).toHaveBeenCalledWith({
      chatId: 1,
      data: {summary: {notes: 'z'}},
    });
    expect(mockGetTags).not.toHaveBeenCalled();
  });

  it('sends tag names without waiting on a ratings call', async () => {
    const {getByTestId, rerender} = render(<Test />);
    await act(async () => {
      getByTestId('change-tags').props.onPress();
    });
    rerender(<Test />);
    await act(async () => {
      await getByTestId('submit').props.onPress();
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      chatId: 1,
      data: {summary: {tags: ['a', 'b']}},
    });
    // The rating used to run before the write: it stalled the save on a slow AI
    // service and, on failure, fell back to the stored tags — discarding what
    // the counsellor had just typed.
    expect(mockGetTags).not.toHaveBeenCalled();
  });

  it('does not write when nothing changed', async () => {
    const {getByTestId} = render(<Test />);
    await act(async () => {
      await getByTestId('submit').props.onPress();
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not write when there is no session loaded', async () => {
    const {getByTestId, rerender} = render(<Test />);
    mockState.summary.summaryData = null as any;
    rerender(<Test />);
    await act(async () => {
      await getByTestId('submit').props.onPress();
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('keeps an unsaved edit when the server copy is refetched', async () => {
    const {getByTestId, rerender} = render(<Test />);
    await act(async () => {
      getByTestId('change-notes').props.onPress();
    });
    rerender(<Test />);
    expect(mockState.summary.formData.notes).toBe('z');

    // A refetch / async AI fill / regeneration landing: `summary` gets a new
    // identity while the counsellor is mid-edit. The seeding effect used to
    // dispatch the server values wholesale and reset the baseline, so the typed
    // value vanished and wasn't even flagged as unsaved any more.
    mockState.summary.summary = {notes: 'y', tags: []};
    rerender(<Test />);

    expect(mockState.summary.formData.notes).toBe('z');
    await waitFor(() =>
      expect(getByTestId('hasChanges').props.children).toBe('true'),
    );
  });

  it('reseeds from the server when a different session is opened', async () => {
    const {getByTestId, rerender} = render(<Test />);
    await act(async () => {
      getByTestId('change-notes').props.onPress();
    });
    rerender(<Test />);
    expect(mockState.summary.formData.notes).toBe('z');

    // Different chat id: the previous session's edits must not follow it over.
    mockState.summary.summaryData = {
      id: 2,
      details: {callInfo: {}, summary: {tags: []}},
    };
    mockState.summary.summary = {notes: 'y', tags: []};
    rerender(<Test />);

    expect(mockState.summary.formData.notes).toBe('y');
  });
});

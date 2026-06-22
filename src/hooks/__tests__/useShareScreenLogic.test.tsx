import {act, renderHook} from '@testing-library/react-native';

import {useShareScreenLogic} from '../useShareScreenLogic';

const mockGoBack = jest.fn();
jest.mock('../useAppNavigation', () => ({
  useAppNavigation: () => ({goBack: mockGoBack, navigate: jest.fn()}),
}));

const mockShowToast = jest.fn();
jest.mock('@/components', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

const defaultParams = {
  onCreateReview: jest.fn(),
  onUpdateStatus: jest.fn(),
};

describe('useShareScreenLogic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    defaultParams.onCreateReview.mockResolvedValue({id: 'new-review'});
    defaultParams.onUpdateStatus.mockResolvedValue(undefined);
  });

  it('returns initial state with empty note', () => {
    const {result} = renderHook(() => useShareScreenLogic(defaultParams));

    expect(result.current.note).toBe('');
    expect(result.current.isEmojiPickerOpen).toBe(false);
    expect(result.current.maxNoteLength).toBe(250);
  });

  it('initializes note from initialNote', () => {
    const {result} = renderHook(() =>
      useShareScreenLogic({...defaultParams, initialNote: 'Hello'}),
    );
    expect(result.current.note).toBe('Hello');
  });

  it('returns share screen title by default', () => {
    const {result} = renderHook(() => useShareScreenLogic(defaultParams));
    expect(result.current.screenTitle).toBe(
      'simulationPage.shareScreenTitle',
    );
    expect(result.current.buttonLabel).toBe('common.share');
  });

  it('returns custom share title when provided', () => {
    const {result} = renderHook(() =>
      useShareScreenLogic({...defaultParams, shareTitle: 'Custom Title'}),
    );
    expect(result.current.screenTitle).toBe('Custom Title');
  });

  it('returns edit note title when isEditNote is true', () => {
    const {result} = renderHook(() =>
      useShareScreenLogic({
        ...defaultParams,
        isEditNote: true,
        reviewId: 'r-1',
      }),
    );
    expect(result.current.screenTitle).toBe(
      'review.details.editNote',
    );
    expect(result.current.buttonLabel).toBe('common.save');
  });

  it('updates note via setNote', () => {
    const {result} = renderHook(() => useShareScreenLogic(defaultParams));

    act(() => {
      result.current.setNote('new note');
    });

    expect(result.current.note).toBe('new note');
  });

  it('appends emoji to note within max length', () => {
    const {result} = renderHook(() => useShareScreenLogic(defaultParams));

    act(() => {
      result.current.handleEmojiSelected({emoji: '😀'} as any);
    });

    expect(result.current.note).toBe('😀');
  });

  it('does not append emoji when note is at max length', () => {
    const {result} = renderHook(() =>
      useShareScreenLogic({...defaultParams, initialNote: 'a'.repeat(250)}),
    );

    act(() => {
      result.current.handleEmojiSelected({emoji: '😀'} as any);
    });

    expect(result.current.note).toBe('a'.repeat(250));
  });

  it('calls onCreateReview and shows success toast on share (no reviewId)', async () => {
    const {result} = renderHook(() => useShareScreenLogic(defaultParams));

    act(() => {
      result.current.setNote('my note');
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(defaultParams.onCreateReview).toHaveBeenCalledWith('my note');
    expect(mockShowToast).toHaveBeenCalledWith(
      'callFeedback.sharedForReview',
      'success',
    );
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('calls onShareSuccess callback instead of goBack when provided', async () => {
    const onShareSuccess = jest.fn();
    const {result} = renderHook(() =>
      useShareScreenLogic({...defaultParams, onShareSuccess}),
    );

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(onShareSuccess).toHaveBeenCalledWith({id: 'new-review'});
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('calls onUpdateStatus when reviewId exists', async () => {
    const {result} = renderHook(() =>
      useShareScreenLogic({...defaultParams, reviewId: 'review-1'}),
    );

    act(() => {
      result.current.setNote('updated note');
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(defaultParams.onUpdateStatus).toHaveBeenCalledWith(
      'review-1',
      'updated note',
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      'callFeedback.sharedForReview',
      'success',
    );
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('shows server error message on share failure', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    defaultParams.onCreateReview.mockRejectedValue({
      data: {message: 'Time expired'},
    });

    const {result} = renderHook(() => useShareScreenLogic(defaultParams));

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(mockShowToast).toHaveBeenCalledWith('Time expired', 'error');
    expect(mockGoBack).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('shows fallback error when no server message', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    defaultParams.onCreateReview.mockRejectedValue(new Error('Fail'));

    const {result} = renderHook(() => useShareScreenLogic(defaultParams));

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      'callFeedback.issues.editNoteExpired',
      'error',
    );
    expect(mockGoBack).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('calls handleEditNote when isEditNote is true', async () => {
    const {result} = renderHook(() =>
      useShareScreenLogic({
        ...defaultParams,
        isEditNote: true,
        reviewId: 'review-1',
      }),
    );

    act(() => {
      result.current.setNote('edited note');
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(defaultParams.onUpdateStatus).toHaveBeenCalledWith(
      'review-1',
      'edited note',
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      'callFeedback.editNoteSuccess',
      'success',
    );
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('handleEditNote does nothing without reviewId', async () => {
    const {result} = renderHook(() =>
      useShareScreenLogic({...defaultParams, isEditNote: true}),
    );

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(defaultParams.onUpdateStatus).not.toHaveBeenCalled();
  });

  it('goBack calls navigation.goBack', () => {
    const {result} = renderHook(() => useShareScreenLogic(defaultParams));

    act(() => {
      result.current.goBack();
    });

    expect(mockGoBack).toHaveBeenCalled();
  });
});

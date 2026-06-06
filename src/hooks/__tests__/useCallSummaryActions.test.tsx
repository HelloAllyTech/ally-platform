import React from 'react';
import {Text} from 'react-native';
import {act, render} from '@testing-library/react-native';

import {useCallSummaryActions} from '../useCallSummaryActions';

const mockUpdateCallInfo = jest.fn(async () => ({unwrap: async () => ({})}));
const mockExport = jest.fn(() => ({unwrap: async () => 'file-contents'}));
const mockUpdateSummary = jest.fn(async () => ({data: {ok: true}}));
const mockAddFeedback = jest.fn(async () => ({data: {success: true}}));

jest.mock('@/services', () => ({
  useArchiveCallLogMutation: () => [
    jest.fn().mockResolvedValue({unwrap: async () => {}}),
  ],
}));

jest.mock('@/services/callSummaryApi', () => ({
  useUpdateCallInfoMutation: () => [mockUpdateCallInfo],
  useLazyExportCallSummaryQuery: () => [mockExport],
  useUpdateCallSummaryMutation: () => [mockUpdateSummary],
  useAddSummaryFeedbackMutation: () => [mockAddFeedback],
}));

jest.mock('@/hooks/useStoragePermissions', () => ({
  useStoragePermissions: () => ({checkAndRequestPermissions: async () => true}),
}));

const mockGoBack = jest.fn();
const mockReset = jest.fn();
jest.mock('@/hooks/useAppNavigation', () => ({
  useAppNavigation: () => ({goBack: mockGoBack, reset: mockReset}),
}));

const mockShowToast = jest.fn();
const mockShowErrorToast = jest.fn();
jest.mock('@/components', () => ({
  useToast: () => ({showToast: mockShowToast}),
  useErrorToast: () => ({showErrorToast: mockShowErrorToast}),
}));

jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
}));

jest.mock('@/utils/fileOperations', () => ({
  saveFile: jest.fn(async () => '/path/file.txt'),
}));

jest.mock('../useTranslate', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

// Capture the latest hook instance for direct assertions
let latestHook: ReturnType<typeof useCallSummaryActions>;

const Test = ({isFlow}: {isFlow: boolean}) => {
  latestHook = useCallSummaryActions({chatId: 1, name: 'Initial', isCallLogSummaryFlow: isFlow});
  return (
    <>
      <Text testID="rename" onPress={() => latestHook.handleSummaryNameChange('NewName')} />
      <Text testID="export" onPress={() => latestHook.handleExport()} />
      <Text testID="delete" onPress={() => latestHook.handleDelete()} />
      <Text testID="update" onPress={() => latestHook.onUpdateSummary(true)} />
      <Text testID="feedback" onPress={() => latestHook.onAddSummaryFeedback({rating: 5, issues: [], comment: '', tags: []})} />
      <Text testID="goBack" onPress={() => latestHook.handleGoBack()} />
    </>
  );
};

describe('useCallSummaryActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles rename, export, delete, update, feedback, and goBack in flow', async () => {
    const {getByTestId} = render(<Test isFlow={true} />);

    await act(async () => {
      getByTestId('rename').props.onPress();
      getByTestId('export').props.onPress();
      getByTestId('delete').props.onPress();
      getByTestId('update').props.onPress();
      getByTestId('feedback').props.onPress();
      getByTestId('goBack').props.onPress();
    });

    expect(mockGoBack).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalled();
  });

  it('goBack resets stack when not in flow', async () => {
    const {getByTestId} = render(<Test isFlow={false} />);

    await act(async () => {
      getByTestId('goBack').props.onPress();
    });

    expect(mockReset).toHaveBeenCalled();
  });

  it('shows error toasts on failures', async () => {
    mockUpdateCallInfo.mockImplementationOnce(async () => ({unwrap: async () => { throw new Error('fail'); }}));
    mockExport.mockImplementationOnce(() => ({unwrap: async () => { throw new Error('bad'); }}));
    mockUpdateSummary.mockImplementationOnce(async () => { throw new Error('oops'); });

    const {getByTestId} = render(<Test isFlow={true} />);

    await act(async () => {
      getByTestId('rename').props.onPress();
      getByTestId('export').props.onPress();
      getByTestId('delete').props.onPress();
    });

    expect(mockShowErrorToast).toHaveBeenCalled();
  });

  describe('onAddSummaryFeedback', () => {
    it('should pass rating from feedback object to addSummaryFeedback', async () => {
      render(<Test isFlow={true} />);

      await act(async () => {
        await latestHook.onAddSummaryFeedback({
          rating: 4,
          issues: [],
          comment: 'Great call',
          tags: [],
        });
      });

      expect(mockAddFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 1,
          rating: 4,
        }),
      );
    });

    it('should pass full feedback object including tags to addSummaryFeedback', async () => {
      render(<Test isFlow={true} />);

      const feedback = {
        rating: 5,
        issues: ['issue1'],
        comment: 'Well done',
        tags: ['tag-a', 'tag-b'],
      };

      await act(async () => {
        await latestHook.onAddSummaryFeedback(feedback);
      });

      expect(mockAddFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 1,
          rating: 5,
          feedback,
        }),
      );
    });

    it('should pass feedback object with empty tags when no tags provided', async () => {
      render(<Test isFlow={true} />);

      const feedback = {
        rating: 3,
        issues: [],
        comment: '',
        tags: [],
      };

      await act(async () => {
        await latestHook.onAddSummaryFeedback(feedback);
      });

      expect(mockAddFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback: expect.objectContaining({tags: []}),
        }),
      );
    });

    it('should return the API response', async () => {
      const apiResponse = {data: {success: true}};
      mockAddFeedback.mockResolvedValueOnce(apiResponse);

      render(<Test isFlow={true} />);

      let result: unknown;
      await act(async () => {
        result = await latestHook.onAddSummaryFeedback({
          rating: 5,
          issues: [],
          comment: '',
          tags: [],
        });
      });

      expect(result).toEqual(apiResponse);
    });

    it('should use chatId from hook params in the API call', async () => {
      render(<Test isFlow={true} />);

      await act(async () => {
        await latestHook.onAddSummaryFeedback({
          rating: 2,
          issues: [],
          comment: 'Needs work',
          tags: ['tag-x'],
        });
      });

      expect(mockAddFeedback).toHaveBeenCalledWith(
        expect.objectContaining({chatId: 1}),
      );
    });
  });
});



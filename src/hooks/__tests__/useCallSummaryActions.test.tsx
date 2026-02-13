import React from 'react';
import {Text} from 'react-native';
import {act, render} from '@testing-library/react-native';

import {useCallSummaryActions} from '../useCallSummaryActions';

const mockUpdateCallInfo = jest.fn(async () => ({unwrap: async () => ({})}));
const mockExport = jest.fn(() => ({unwrap: async () => 'file-contents'}));
const mockUpdateSummary = jest.fn(async () => ({data: {ok: true}}));
const mockAddFeedback = jest.fn(async () => ({data: {ok: true}}));

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

const Test = ({isFlow}: {isFlow: boolean}) => {
  const hook = useCallSummaryActions({chatId: 1, name: 'Initial', isCallLogSummaryFlow: isFlow});
  return (
    <>
      <Text testID="rename" onPress={() => hook.handleSummaryNameChange('NewName')} />
      <Text testID="export" onPress={() => hook.handleExport()} />
      <Text testID="delete" onPress={() => hook.handleDelete()} />
      <Text testID="update" onPress={() => hook.onUpdateSummary(true)} />
      <Text testID="feedback" onPress={() => hook.onAddSummaryFeedback(5, {issues: [], comment: ''})} />
      <Text testID="goBack" onPress={() => hook.handleGoBack()} />
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
});



import {act, renderHook} from '@testing-library/react-native';

import {useErrorToast, useToast} from '@/components';
import {useCreateBugReportMutation} from '@/services';
import {getBugReportContext} from '@/utils';

import {useBugReport} from '../useBugReport';

jest.mock('@/components', () => ({
  useToast: jest.fn(),
  useErrorToast: jest.fn(),
}));

jest.mock('@/services', () => ({
  useCreateBugReportMutation: jest.fn(),
}));

jest.mock('@/utils', () => ({
  getBugReportContext: jest.fn(() => ({
    screen: 'CallLog',
    appVersion: '1.2.3',
    device: 'Google Pixel 7',
    os: 'Android 14',
    clientTimestamp: '2026-08-18T00:00:00.000Z',
  })),
}));

jest.mock('../useTranslate', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

const mockShowToast = jest.fn();
const mockShowErrorToast = jest.fn();
const mockCreateBugReport = jest.fn();

describe('useBugReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({showToast: mockShowToast});
    (useErrorToast as jest.Mock).mockReturnValue({
      showErrorToast: mockShowErrorToast,
    });
    (useCreateBugReportMutation as jest.Mock).mockReturnValue([
      mockCreateBugReport,
    ]);
  });

  it('starts with an empty description and submit disabled', () => {
    const {result} = renderHook(() => useBugReport({}));

    expect(result.current.description).toBe('');
    expect(result.current.canSubmit).toBe(false);
  });

  it('enables submit once the guided field has content', () => {
    const {result} = renderHook(() => useBugReport({}));

    act(() => {
      result.current.setDescription('The app crashed on call start');
    });

    expect(result.current.canSubmit).toBe(true);
  });

  it('disables submit again if the description is only whitespace', () => {
    const {result} = renderHook(() => useBugReport({}));

    act(() => {
      result.current.setDescription('   ');
    });

    expect(result.current.canSubmit).toBe(false);
  });

  it('submits the trimmed description with silently-gathered context', async () => {
    mockCreateBugReport.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue({id: '1', stage: 'new'}),
    });
    const onSuccess = jest.fn();
    const {result} = renderHook(() =>
      useBugReport({screen: 'CallLog', onSuccess}),
    );

    act(() => {
      result.current.setDescription('  The app crashed  ');
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(getBugReportContext).toHaveBeenCalledWith('CallLog');
    expect(mockCreateBugReport).toHaveBeenCalledWith({
      description: 'The app crashed',
      context: {
        screen: 'CallLog',
        appVersion: '1.2.3',
        device: 'Google Pixel 7',
        os: 'Android 14',
        clientTimestamp: '2026-08-18T00:00:00.000Z',
      },
    });
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'bugReport.successMessage',
      type: 'success',
    });
    expect(result.current.description).toBe('');
    expect(onSuccess).toHaveBeenCalled();
  });

  it('shows a plain rate-limit message on a 429, without retry logic', async () => {
    mockCreateBugReport.mockReturnValue({
      unwrap: jest.fn().mockRejectedValue({status: 429}),
    });
    const {result} = renderHook(() => useBugReport({}));

    act(() => {
      result.current.setDescription('Something broke');
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'bugReport.rateLimitMessage',
      type: 'error',
    });
    expect(mockShowErrorToast).not.toHaveBeenCalled();
    // description is preserved so the user doesn't retype after a rate limit
    expect(result.current.description).toBe('Something broke');
  });

  it('shows a generic error toast on any other failure', async () => {
    const error = new Error('network down');
    mockCreateBugReport.mockReturnValue({
      unwrap: jest.fn().mockRejectedValue(error),
    });
    const {result} = renderHook(() => useBugReport({}));

    act(() => {
      result.current.setDescription('Something broke');
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockShowErrorToast).toHaveBeenCalledWith(
      error,
      'errors.submitBugReport',
    );
  });

  it('does not submit when canSubmit is false', async () => {
    const {result} = renderHook(() => useBugReport({}));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockCreateBugReport).not.toHaveBeenCalled();
  });
});

import {act, renderHook} from '@testing-library/react-native';

jest.mock('@/services', () => ({}));

import {useToggleReviewPrivacy} from '../useToggleReviewPrivacy';

const mockShowToast = jest.fn();
jest.mock('@/components', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

const mockUpdateReviewStatus = jest.fn();
const mockUnwrap = jest.fn();

const mockUseUpdateMutation = (() => [
  (...args: any[]) => {
    mockUpdateReviewStatus(...args);
    return {unwrap: mockUnwrap};
  },
  {isLoading: false},
]) as any;

describe('useToggleReviewPrivacy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnwrap.mockResolvedValue({});
  });

  it('returns handleTogglePrivate function', () => {
    const {result} = renderHook(() =>
      useToggleReviewPrivacy('review-1', mockUseUpdateMutation),
    );
    expect(typeof result.current.handleTogglePrivate).toBe('function');
  });

  it('does nothing when reviewId is undefined', async () => {
    const {result} = renderHook(() =>
      useToggleReviewPrivacy(undefined, mockUseUpdateMutation),
    );

    await act(async () => {
      await result.current.handleTogglePrivate(true);
    });

    expect(mockUpdateReviewStatus).not.toHaveBeenCalled();
  });

  it('sets status to IN_REVIEW when toggling on', async () => {
    const {result} = renderHook(() =>
      useToggleReviewPrivacy('review-1', mockUseUpdateMutation),
    );

    await act(async () => {
      await result.current.handleTogglePrivate(true);
    });

    expect(mockUpdateReviewStatus).toHaveBeenCalledWith({
      reviewId: 'review-1',
      body: {status: 'IN_REVIEW'},
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      'simulationPage.privacyUpdated',
      'success',
    );
  });

  it('sets status to HIDDEN when toggling off', async () => {
    const {result} = renderHook(() =>
      useToggleReviewPrivacy('review-1', mockUseUpdateMutation),
    );

    await act(async () => {
      await result.current.handleTogglePrivate(false);
    });

    expect(mockUpdateReviewStatus).toHaveBeenCalledWith({
      reviewId: 'review-1',
      body: {status: 'HIDDEN'},
    });
  });

  it('shows error toast on failure', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockUnwrap.mockRejectedValue(new Error('API error'));

    const {result} = renderHook(() =>
      useToggleReviewPrivacy('review-1', mockUseUpdateMutation),
    );

    await act(async () => {
      await result.current.handleTogglePrivate(true);
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      'simulationPage.errorUpdatePrivacy',
      'error',
    );
    consoleSpy.mockRestore();
  });
});

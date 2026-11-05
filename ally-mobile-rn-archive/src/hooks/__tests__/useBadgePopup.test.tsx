import {act, renderHook, waitFor} from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

jest.mock('react-redux', () => ({
  useSelector: jest.fn((fn: (state: unknown) => unknown) =>
    fn({user: {permissions: ['view_user_badges']}}),
  ),
}));

jest.mock('@/constants', () => ({
  BADGE_AUTO_CLOSE_DELAY: 5000,
  BADGE_CLOSE_ANIMATION_DELAY: 300,
  BADGE_INITIAL_SHOW_DELAY: 500,
  BADGE_NEXT_BADGE_DELAY: 200,
  BADGE_POLLING_INTERVAL: 30000,
  ViewedStatus: {UNVIEWED: 'unviewed'},
}));

jest.mock('@/constants/permissions', () => ({
  USER_PERMISSIONS: {VIEW_USER_BADGES: 'view_user_badges'},
}));

jest.mock('@/services', () => ({
  useGetBadgesQuery: jest.fn(() => ({data: null, isLoading: false})),
  useMarkBadgeAsViewedMutation: jest.fn(() => [
    jest.fn().mockReturnValue({unwrap: jest.fn().mockResolvedValue({})}),
  ]),
}));

jest.mock('@/utils', () => ({
  logger: {error: jest.fn()},
}));

import {useGetBadgesQuery} from '@/services';

import {useBadgePopup} from '../useBadgePopup';

describe('useBadgePopup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useGetBadgesQuery as jest.Mock).mockReturnValue({data: null, isLoading: false});
  });

  it('initializes with no current badge and not loading', async () => {
    const {result} = renderHook(() => useBadgePopup(false, null));

    await waitFor(() => {
      expect(result.current.currentBadge).toBeNull();
      expect(result.current.isBadgesLoading).toBe(false);
    });
  });

  it('returns isBadgesLoading false when query is not loading', async () => {
    (useGetBadgesQuery as jest.Mock).mockReturnValue({
      data: {data: []},
      isLoading: false,
    });

    const {result} = renderHook(() => useBadgePopup(false, null));

    await waitFor(() => {
      expect(result.current.isBadgesLoading).toBe(false);
    });

    act(() => {
      expect(result.current.closeBadge).toBeDefined();
    });
  });
});

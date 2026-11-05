import {act, renderHook} from '@testing-library/react-native';

import {getFirstVisibleTab} from '@/navigation/TabNavigator';

import {useTabScreenHeader} from '../useTabScreenHeader';

const mockOpenDrawer = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({name: 'HomeTab'}),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: jest.fn((fn: (state: unknown) => unknown) =>
    fn({user: {permissions: ['perm1']}}),
  ),
}));

jest.mock('@/navigation/TabNavigator', () => ({
  getFirstVisibleTab: jest.fn(() => 'HomeTab'),
}));

jest.mock('../useDrawerNavigation', () => ({
  useDrawerNavigation: () => ({openDrawer: mockOpenDrawer}),
}));

describe('useTabScreenHeader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getFirstVisibleTab as jest.Mock).mockReturnValue('HomeTab');
  });

  it('showHamburger is true when route matches first visible tab', () => {
    const {result} = renderHook(() => useTabScreenHeader());

    expect(result.current.showHamburger).toBe(true);
    expect(getFirstVisibleTab).toHaveBeenCalledWith(['perm1']);
  });

  it('handleOpenDrawer calls openDrawer on drawer navigation', () => {
    const {result} = renderHook(() => useTabScreenHeader());

    act(() => {
      result.current.handleOpenDrawer();
    });

    expect(mockOpenDrawer).toHaveBeenCalledTimes(1);
  });
});

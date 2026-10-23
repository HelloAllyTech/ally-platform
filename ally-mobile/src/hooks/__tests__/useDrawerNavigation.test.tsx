import {act, renderHook, waitFor} from '@testing-library/react-native';

// jest.setup.ts mocks this hook for other tests; use the real implementation here
jest.mock('@/hooks/useDrawerNavigation', () =>
  jest.requireActual('@/hooks/useDrawerNavigation'),
);

const mockNavigation = {
  openDrawer: jest.fn(),
  closeDrawer: jest.fn(),
  navigate: jest.fn(),
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

import {useDrawerNavigation} from '../useDrawerNavigation';

describe('useDrawerNavigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns navigation object with openDrawer, closeDrawer functions', async () => {
    const {result} = renderHook(() => useDrawerNavigation());

    await waitFor(() => {
      expect(result.current).toBe(mockNavigation);
    });

    expect(typeof result.current.openDrawer).toBe('function');
    expect(typeof result.current.closeDrawer).toBe('function');

    act(() => {
      result.current.openDrawer();
      result.current.closeDrawer();
    });

    expect(mockNavigation.openDrawer).toHaveBeenCalled();
    expect(mockNavigation.closeDrawer).toHaveBeenCalled();
  });
});

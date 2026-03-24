import {act, renderHook, waitFor} from '@testing-library/react-native';

const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  reset: jest.fn(),
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

import {useAppNavigation} from '../useAppNavigation';

describe('useAppNavigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns navigation object with navigate, goBack, reset functions', async () => {
    const {result} = renderHook(() => useAppNavigation());

    await waitFor(() => {
      expect(result.current).toBe(mockNavigation);
    });

    expect(typeof result.current.navigate).toBe('function');
    expect(typeof result.current.goBack).toBe('function');
    expect(typeof result.current.reset).toBe('function');

    act(() => {
      result.current.navigate('SomeScreen' as never);
      result.current.goBack();
      result.current.reset({index: 0, routes: []} as never);
    });

    expect(mockNavigation.navigate).toHaveBeenCalled();
    expect(mockNavigation.goBack).toHaveBeenCalled();
    expect(mockNavigation.reset).toHaveBeenCalled();
  });
});

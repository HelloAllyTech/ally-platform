import AsyncStorage from '@react-native-async-storage/async-storage';

import {AsyncStorageKeys} from '@/constants';

import {getItem, removeItem, setItem} from '../asyncStorage';
import {logger} from '../logger';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../logger', () => ({
  logger: {
    error: jest.fn(),
  },
}));

describe('AsyncStorage Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should set an item in AsyncStorage', async () => {
    await setItem(AsyncStorageKeys.ACCESS_TOKEN, {test: 'value'});
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      AsyncStorageKeys.ACCESS_TOKEN,
      JSON.stringify({test: 'value'}),
    );
  });

  it('should get an item from AsyncStorage', async () => {
    const mockGetItem = AsyncStorage.getItem as jest.MockedFunction<
      typeof AsyncStorage.getItem
    >;
    mockGetItem.mockResolvedValueOnce(JSON.stringify({test: 'value'}));
    const result = await getItem(AsyncStorageKeys.ACCESS_TOKEN);
    expect(result).toEqual({test: 'value'});
  });

  it('should remove an item from AsyncStorage', async () => {
    await removeItem(AsyncStorageKeys.ACCESS_TOKEN);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      AsyncStorageKeys.ACCESS_TOKEN,
    );
  });

  it('should log an error if setItem fails', async () => {
    const mockSetItem = AsyncStorage.setItem as jest.MockedFunction<
      typeof AsyncStorage.setItem
    >;
    mockSetItem.mockRejectedValueOnce(new Error('set error'));
    await setItem(AsyncStorageKeys.ACCESS_TOKEN, {test: 'value'});
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('set error'),
    );
  });

  it('should log an error if getItem fails', async () => {
    const mockGetItem = AsyncStorage.getItem as jest.MockedFunction<
      typeof AsyncStorage.getItem
    >;
    mockGetItem.mockRejectedValueOnce(new Error('get error'));
    await getItem(AsyncStorageKeys.ACCESS_TOKEN);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('get error'),
    );
  });

  it('should log an error if removeItem fails', async () => {
    const mockRemoveItem = AsyncStorage.removeItem as jest.MockedFunction<
      typeof AsyncStorage.removeItem
    >;
    mockRemoveItem.mockRejectedValueOnce(new Error('remove error'));
    await removeItem(AsyncStorageKeys.ACCESS_TOKEN);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('remove error'),
    );
  });
});

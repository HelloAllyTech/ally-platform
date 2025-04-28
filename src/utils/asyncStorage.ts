import AsyncStorage from '@react-native-async-storage/async-storage';

import {AsyncStorageKeys} from '@/constants/asyncStorage';

export const setItem = async <T>(
  key: AsyncStorageKeys,
  value: T,
): Promise<void> => {
  try {
    const jsonValue = JSON.stringify(value);
    await AsyncStorage.setItem(key, jsonValue);
  } catch (e) {
    console.error(`AsyncStorage set error [${key}]:`, e);
  }
};

export const getItem = async <T>(key: AsyncStorageKeys): Promise<T | null> => {
  try {
    const jsonValue = await AsyncStorage.getItem(key);
    return jsonValue !== null ? JSON.parse(jsonValue) : null;
  } catch (e) {
    console.error(`AsyncStorage get error [${key}]:`, e);
    return null;
  }
};

export const removeItem = async (key: AsyncStorageKeys): Promise<void> => {
  try {
    await AsyncStorage.removeItem(key);
  } catch (e) {
    console.error(`AsyncStorage remove error [${key}]:`, e);
  }
};

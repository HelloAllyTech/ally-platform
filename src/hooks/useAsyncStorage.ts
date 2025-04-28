import AsyncStorage from '@react-native-async-storage/async-storage';
import {useCallback, useEffect, useState} from 'react';

import {AsyncStorageKeys} from '@/constants/asyncStorage';

export const useAsyncStorage = <T>(key: AsyncStorageKeys) => {
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  if (!key) {
    throw new Error('Storage key is required');
  }

  const getStoredValue = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const item = await AsyncStorage.getItem(key);
      setValue(item ? JSON.parse(item) : null);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to read from storage'),
      );
      console.error('Error reading from AsyncStorage:', err);
    } finally {
      setLoading(false);
    }
  }, [key]);

  const updateValue = useCallback(
    async (newValue: T) => {
      try {
        setLoading(true);
        setError(null);
        await AsyncStorage.setItem(key, JSON.stringify(newValue));
        setValue(newValue);
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to write to storage'),
        );
        console.error('Error writing to AsyncStorage:', err);
      } finally {
        setLoading(false);
      }
    },
    [key],
  );

  const remove = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await AsyncStorage.removeItem(key);
      setValue(null);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to remove from storage'),
      );
      console.error('Error removing from AsyncStorage:', err);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    getStoredValue();
  }, [getStoredValue]);

  return {value, setValue: updateValue, remove, loading, error};
};

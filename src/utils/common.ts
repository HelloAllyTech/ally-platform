import Clipboard from '@react-native-clipboard/clipboard';
import {Linking, Platform} from 'react-native';

import {ALLOWED_ROLES, APP_STORE_URLS} from '@/constants';
import {User} from '@/types';

export type Maybe<T> = T | null;

// Decode helpers and a unified payload-to-JSON converter used across the app
export const tryParseJson = (str: string): unknown => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

export const uint8ToString = (bytes: Uint8Array): string => {
  let result = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    result += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return result;
};

export const copyToClipboard = (text: string) => {
  Clipboard.setString(text);
};

export const openAppStore = async (): Promise<void> => {
  const storeUrl = Platform.select(APP_STORE_URLS);

  if (storeUrl) {
    await Linking.openURL(storeUrl);
  }
};

export const isAppFeatureEnabled = (user: User): boolean => {
  return ALLOWED_ROLES.includes(user.role);
};

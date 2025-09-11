import Clipboard from '@react-native-clipboard/clipboard';

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

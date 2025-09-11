import Clipboard from '@react-native-community/clipboard';

export type Maybe<T> = T | null;

export const copyToClipboard = (text: string) => {
  Clipboard.setString(text);
};

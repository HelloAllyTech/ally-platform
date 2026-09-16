import {AudioSession} from '@livekit/react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {Linking, Platform} from 'react-native';
import SoundPlayer from 'react-native-sound-player';

import {APP_STORE_URLS, BadgeCategory, isIOS} from '@/constants';

import {logger} from './logger';

export type Maybe<T> = T | null;

export const isValidEmail = (emailAddress: string) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(emailAddress);
};

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

export const stringToUint8 = (str: string): Uint8Array => {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
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

export const playNotificationSound = async (soundFile: number) => {
  try {
    // Enable mix audio mode to play at full volume alongside voice session
    SoundPlayer.setMixAudio(true);

    // Ensure speaker output on iOS
    if (isIOS) {
      await AudioSession.configureAudio({
        ios: {
          defaultOutput: 'speaker',
        },
      });
    }

    SoundPlayer.playAsset(soundFile);

    SoundPlayer.setMixAudio(false);
  } catch (error) {
    logger.error(`Failed to play notification sound: ${error}`);
  }
};

export const BADGE_CATEGORY_MAP: Record<BadgeCategory, string> = {
  [BadgeCategory.SIMULATION_MINUTES]: 'journey',
  [BadgeCategory.ACTIVE_DAY_STREAK]: 'momentum',
  [BadgeCategory.COMMENTS_REACTIONS_GIVEN]: 'contribution',
  [BadgeCategory.COMMENTS_REACTIONS_RECEIVED]: 'resonance',
};

/**
 * Formats a value as a percentage
 * @param value - Numeric value (0-1 for decimal, or any number)
 * @returns Formatted percentage string (e.g., "75%") or "-" if no value
 * @example
 * formatAsPercentage(0.75) // returns "75%"
 * formatAsPercentage(null) // returns "-"
 */
export const formatAsPercentage = (value: unknown): string => {
  if (!value) return '-';
  return `${Math.round(Number(value) * 100)}%`;
};

/**
 * Formats a value as a string, handling special cases
 * @param value - Value to format
 * @returns Formatted string, "N/A" for -1, "-" for falsy values, or string representation
 * @example
 * formatAsStringOrDash(-1) // returns "N/A"
 * formatAsStringOrDash(null) // returns "-"
 * formatAsStringOrDash(123) // returns "123"
 */
export const formatAsStringOrDash = (value: unknown): string => {
  if (value === -1) return 'N/A';
  if (!value) return '-';
  return String(value);
};

export const calculateAverageForObjectArray = <T, K extends keyof T>(
  arr: T[],
  key: K,
): number => {
  if (!arr.length) return 0;

  const total = arr.reduce((sum, item) => {
    const value = item[key];
    return sum + Number(value);
  }, 0);

  return Math.round(total / arr.length);
};

export const capitalizeFirstLetter = (string: string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

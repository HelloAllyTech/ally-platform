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
  [BadgeCategory.SIMULATION_MINUTES]: 'Journey',
  [BadgeCategory.ACTIVE_DAY_STREAK]: 'Momentum',
  [BadgeCategory.COMMENTS_REACTIONS_GIVEN]: 'Contribution',
  [BadgeCategory.COMMENTS_REACTIONS_RECEIVED]: 'Resonance',
};

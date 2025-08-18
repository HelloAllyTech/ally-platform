import {Dimensions, Platform} from 'react-native';

export const MICROPHONE_AUDIO_SAMPLE_RATE = 16000;

export const DEFAULT_HIT_SLOP = {
  top: 10,
  bottom: 10,
  left: 10,
  right: 10,
};

export const SCREEN_WIDTH = Dimensions.get('window').width;
export const WINDOW_HEIGHT = Dimensions.get('window').height;

export const isIOS = Platform.OS === 'ios';

export enum LanguageCode {
  EN = 'en',
}

export const TAG_COLORS = {
  1: {bg: '#FEE1E180', text: '#C62828'},
  2: {bg: '#FFE8D580', text: '#F55A00'},
  3: {bg: '#EBEBEB80', text: '#424242'},
  4: {bg: '#D7F4DC80', text: '#388E3C'},
  5: {bg: '#B9EFC880', text: '#1B5E20'},
};

export const isValidEmail = (emailAddress: string) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(emailAddress);
};

export enum AllyPlatforms {
  WEB = 'WEB',
  MOBILE = 'MOBILE',
}

export enum LanguageMap {
  bn = 'Bengali',
  en = 'English',
  gu = 'Gujarati',
  hi = 'Hindi',
  kn = 'Kannada',
  ml = 'Malayalam',
  or = 'Oriya',
  pa = 'Punjabi',
  ta = 'Tamil',
  te = 'Telugu',
}

// API route constants
export const API_ROUTES = {
  SEND_OTP: '/auth/send-otp',
  VERIFY_OTP: '/auth/verify-otp',
  ROOMS: '/rooms',
  SCENARIOS: '/scenarios',
  FEEDBACK: '/feedback/', // slash appended at the end to fix Fastapi bug
} as const;

export const API_METHODS = {
  GET: 'GET',
  POST: 'POST',
  DELETE: 'DELETE',
} as const;

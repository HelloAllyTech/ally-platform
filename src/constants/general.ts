import {Dimensions, Platform} from 'react-native';
import {ms} from 'react-native-size-matters';

import {carousel1, carousel2, carousel3, carousel4} from '@/assets';
import {CarouselItem} from '@/components';
import {CarouselConfig} from '@/components/Carousel/types';
import {colors, fontFamily} from '@/theme';

export const MICROPHONE_AUDIO_SAMPLE_RATE = 16000;
export const MINUTES_IN_MS = 60 * 1000;
export const SECONDS_IN_MS = 1000;

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

export enum LogType {
  REAL = 'real',
  SIMULATION = 'simulation',
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
  ROOMS: '/rooms',
  SCENARIOS: '/learn/scenarios',
  FEEDBACK: '/feedback/', // slash appended at the end to fix Fastapi bug
  ADMIN_SIMULATION_LOGS: '/learn/admin-scenario-sessions',
  SIMULATION_LOGS: '/learn/scenario-sessions',
  END_SCENARIO_SESSION: '/learn/scenario-session',
  SCENARIO_SESSION_START: '/learn/scenario-session-start',
  SIMULATION_DETAILS: '/learn/scenario-session',
  SIMULATION_MESSAGES: '/learn/scenario-session/:scenarioSessionId/messages',
} as const;

export const API_METHODS = {
  GET: 'GET',
  POST: 'POST',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
  PUT: 'PUT',
} as const;

export const TERMS_AND_CONDITIONS_URL = 'https://helloally.ai/terms';
export const PRIVACY_POLICY_URL = 'https://helloally.ai/policy';

export const SECURITY_CAROUSEL_SLIDES: CarouselItem[] = [
  {image: carousel1, textKey: 'Carousel.slide1'},
  {image: carousel2, textKey: 'Carousel.slide2'},
  {image: carousel3, textKey: 'Carousel.slide3'},
  {image: carousel4, textKey: 'Carousel.slide4'},
];

export enum CarouselVariant {
  DRAWER = 'drawer',
  DEFAULT = 'default',
}

export const drawerSecurityCarouselConfig: CarouselConfig = {
  width: SCREEN_WIDTH - 80,
  isBlurView: false,
  paginationActiveDotStyle: {
    backgroundColor: colors.black,
  },
  imageContainerCustomStyle: {
    width: '90%',
    height: ms(250),
    padding: 4,
    borderRightWidth: 1,
    borderLeftWidth: 1,
  },
  titleCustomStyle: {
    color: colors.darkGray2,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: ms(18),
  },
};

export const defaultSecurityCarouselConfig: CarouselConfig = {
  width: SCREEN_WIDTH,
  isBlurView: true,
  paginationActiveDotStyle: {
    backgroundColor: colors.white,
  },
  imageContainerCustomStyle: {
    borderWidth: 0,
    borderRightWidth: 0,
    borderLeftWidth: 0,
    overflow: 'hidden',
  },
  titleCustomStyle: {
    color: colors.white,
  },
};

export const APP_STORE_URLS = {
  ios: 'https://apps.apple.com/app/helloally/id6745545012',
  android: 'https://play.google.com/store/apps/details?id=com.helloally.app',
};

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export enum KeyCode {
  Backspace = 'Backspace',
  Enter = 'Enter',
  Return = 'Return',
}

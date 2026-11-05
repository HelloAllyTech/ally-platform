jest.mock('react-native', () => ({
  Dimensions: {get: () => ({width: 360, height: 640})},
  Platform: {OS: 'ios'},
}));

jest.mock('react-native-size-matters', () => ({
  ms: (n: number) => n,
}));

import {
  MICROPHONE_AUDIO_SAMPLE_RATE,
  DEFAULT_HIT_SLOP,
  SCREEN_WIDTH,
  WINDOW_HEIGHT,
  isIOS,
  LanguageCode,
  TAG_COLORS,
  API_ROUTES,
  API_METHODS,
  TERMS_AND_CONDITIONS_URL,
  PRIVACY_POLICY_URL,
  CarouselVariant,
  drawerSecurityCarouselConfig,
  defaultSecurityCarouselConfig,
  APP_STORE_URLS,
  SortOrder,
  KeyCode,
} from '../general';
import {isValidEmail} from '../../utils/common';

describe('constants/general', () => {
  it('basic constants', () => {
    expect(MICROPHONE_AUDIO_SAMPLE_RATE).toBe(16000);
    expect(DEFAULT_HIT_SLOP.top).toBe(10);
    expect(SCREEN_WIDTH).toBe(360);
    expect(WINDOW_HEIGHT).toBe(640);
    expect(isIOS).toBe(true);
  });

  it('enums and routes', () => {
    expect(LanguageCode.EN).toBe('en');
    expect(API_ROUTES.LEARN.ROOMS).toContain('/rooms');
    expect(API_METHODS.POST).toBe('POST');
    expect(TERMS_AND_CONDITIONS_URL).toContain('terms');
    expect(PRIVACY_POLICY_URL).toContain('privacy');
  });

  it('carousel configs', () => {
    expect(drawerSecurityCarouselConfig.width).toBeGreaterThan(0);
    expect(defaultSecurityCarouselConfig.isBlurView).toBe(true);
  });

  it('url, sort and key enums', () => {
    expect(APP_STORE_URLS.ios).toContain('apple');
    expect(SortOrder.ASC).toBe('ASC');
    expect(KeyCode.Enter).toBe('Enter');
  });

  it('email validation and tag colors', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(TAG_COLORS[1].bg).toBeTruthy();
  });

  it('all API methods defined', () => {
    expect(API_METHODS.GET).toBe('GET');
    expect(API_METHODS.POST).toBe('POST');
    expect(API_METHODS.PUT).toBe('PUT');
    expect(API_METHODS.PATCH).toBe('PATCH');
    expect(API_METHODS.DELETE).toBe('DELETE');
  });

  it('all API routes for auth', () => {
    expect(API_ROUTES.AUTH.REFRESH).toBe('/auth/refresh');
    expect(API_ROUTES.AUTH.GENERATE_OTP).toBe('/auth/generate-otp');
    expect(API_ROUTES.AUTH.VERIFY_OTP).toBe('/auth/verify-otp');
    expect(API_ROUTES.AUTH.GOOGLE_LOGIN).toBe('/auth/google');
    expect(API_ROUTES.AUTH.APPLE_LOGIN).toBe('/auth/apple');
    expect(API_ROUTES.AUTH.PERMISSIONS).toBe('/authorization/permissions');
  });

  it('all API routes for users', () => {
    expect(API_ROUTES.USERS.ME).toBe('/users/me');
    expect(API_ROUTES.USERS.GET_USER_PREFERENCES).toBe('/users/me/preferences');
    expect(API_ROUTES.USERS.UPDATE_USER_PREFERENCES).toBe('/users/preferences');
  });

  it('chat routes with parameters', () => {
    expect(API_ROUTES.CHATS.BY_ID(123)).toBe('/chats/123');
    expect(API_ROUTES.CHATS.END(456)).toBe('/chats/456/end');
    expect(API_ROUTES.CHATS.NOTES(789)).toBe('/chats/789/notes');
  });

  it('all API routes for learn/simulations', () => {
    expect(API_ROUTES.LEARN.GET_AVAILABLE_LANGUAGES).toBe('/learn/scenario-languages');
  });

  it('all tag colors defined', () => {
    expect(TAG_COLORS[1]).toBeDefined();
    expect(TAG_COLORS[2]).toBeDefined();
    expect(TAG_COLORS[3]).toBeDefined();
    expect(TAG_COLORS[4]).toBeDefined();
    expect(TAG_COLORS[5]).toBeDefined();
  });

  it('carousel variant enum', () => {
    expect(CarouselVariant.DRAWER).toBe('drawer');
    expect(CarouselVariant.DEFAULT).toBe('default');
  });

  it('drawer carousel config defined', () => {
    expect(drawerSecurityCarouselConfig).toBeDefined();
    expect(drawerSecurityCarouselConfig.width).toBeGreaterThan(0);
  });

  it('default carousel config defined', () => {
    expect(defaultSecurityCarouselConfig).toBeDefined();
    expect(defaultSecurityCarouselConfig.isBlurView).toBe(true);
  });

  it('sort order enum values', () => {
    expect(SortOrder.ASC).toBeDefined();
    expect(SortOrder.DESC).toBeDefined();
  });

  it('key code enum values', () => {
    expect(KeyCode).toBeDefined();
  });

  it('app store URLs for both platforms', () => {
    expect(APP_STORE_URLS.ios).toBeDefined();
    expect(APP_STORE_URLS.android).toBeDefined();
  });

  it('allowed roles array', () => {
    const {ALLOWED_ROLES} = require('../general');
    expect(ALLOWED_ROLES).toBeDefined();
    expect(Array.isArray(ALLOWED_ROLES)).toBe(true);
  });

  it('ally platforms enum', () => {
    const {AllyPlatforms} = require('../general');
    expect(AllyPlatforms.WEB).toBe('WEB');
    expect(AllyPlatforms.MOBILE).toBe('MOBILE');
  });

  it('log type enum', () => {
    const {LogType} = require('../general');
    expect(LogType.REAL).toBe('real');
    expect(LogType.SIMULATION).toBe('simulation');
  });

  it('language map enum', () => {
    const {LanguageMap} = require('../general');
    expect(LanguageMap.en).toBe('English');
    expect(LanguageMap.hi).toBe('Hindi');
    expect(LanguageMap.ta).toBe('Tamil');
  });

  it('time constants', () => {
    const {MINUTES_IN_MS, MINUTES_IN_SECONDS, SECONDS_IN_MS} = require('../general');
    expect(MINUTES_IN_MS).toBe(60000);
    expect(MINUTES_IN_SECONDS).toBe(60);
    expect(SECONDS_IN_MS).toBe(1000);
  });

  it('API version enum', () => {
    const {APIVersion} = require('../general');
    expect(APIVersion.V1).toBe('v1');
    expect(APIVersion.V2).toBe('v2');
  });
});

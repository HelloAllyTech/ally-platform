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
    expect(PRIVACY_POLICY_URL).toContain('policy');
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
});

import {
  isSupportedDeepLink,
  getCallIdFromUrl,
  getCourseIdFromUrl,
  isCourseLink,
  navigateToCallSummaryOrLog,
} from '../deeplink';

jest.mock('@/config/env', () => ({
  env: {ALLY_WEB_URL: 'https://ally.example.com'},
}));

describe('deeplink utils', () => {
  it('validates supported deep links and extracts call id', () => {
    const url = new URL('https://ally.example.com/summary/123');
    expect(isSupportedDeepLink(url)).toBe(true);
    expect(getCallIdFromUrl(url)).toBe(123);

    const bad = new URL('https://ally.example.com/other/123');
    expect(isSupportedDeepLink(bad)).toBe(false);
    // getCallIdFromUrl only parses path, independent of support check
    expect(getCallIdFromUrl(bad)).toBe(123);
  });

  it('accepts course share links and extracts the course id', () => {
    const trackId = '96d570f0-14b6-42d7-8e78-79d7520c7f69';
    const url = new URL(`https://ally.example.com/course/${trackId}`);
    expect(isSupportedDeepLink(url)).toBe(true);
    expect(isCourseLink(url)).toBe(true);
    expect(getCourseIdFromUrl(url)).toBe(trackId);
  });

  it('rejects course links on another host and course ids that are not uuids', () => {
    const otherHost = new URL(
      'https://evil.example.com/course/96d570f0-14b6-42d7-8e78-79d7520c7f69',
    );
    expect(isSupportedDeepLink(otherHost)).toBe(false);

    const numeric = new URL('https://ally.example.com/course/123');
    expect(isCourseLink(numeric)).toBe(true);
    expect(getCourseIdFromUrl(numeric)).toBeUndefined();

    const summary = new URL('https://ally.example.com/summary/123');
    expect(isCourseLink(summary)).toBe(false);
    expect(getCourseIdFromUrl(summary)).toBeUndefined();
  });

  it('navigates with reset when possible, or falls back to navigate', () => {
    const reset = jest.fn();
    const navigate = jest.fn();
    const getRootState = jest.fn(() => ({}));
    const ref: any = {reset, navigate, getRootState};

    navigateToCallSummaryOrLog(ref, 42, true);
    expect(reset).toHaveBeenCalled();

    // Without root state, fallback to navigate
    reset.mockClear();
    const ref2: any = {navigate};
    navigateToCallSummaryOrLog(ref2, 7, false);
    expect(navigate).toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
});



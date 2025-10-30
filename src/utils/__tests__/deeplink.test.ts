import {isSupportedDeepLink, getCallIdFromUrl, navigateToCallSummaryOrLog} from '../deeplink';

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



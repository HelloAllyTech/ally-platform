import {SCREEN_NAMES} from '@/constants';

import {
  navigateToCallLogTab,
  navigateToCommunityTab,
  navigateToLearnTab,
  navigateToSearchTab,
  navigateToTab,
  navigateToUserAnalyticsTab,
} from '../navigation';

jest.mock('react-native-permissions', () => ({
  PERMISSIONS: {
    IOS: {
      MICROPHONE: 'ios.permission.MICROPHONE',
    },
    ANDROID: {
      RECORD_AUDIO: 'android.permission.RECORD_AUDIO',
    },
  },
}));

const mockNavigation = {
  dispatch: jest.fn(),
  navigate: jest.fn(),
  reset: jest.fn(),
  goBack: jest.fn(),
  isFocused: jest.fn(),
  canGoBack: jest.fn(),
  getId: jest.fn(),
  getParent: jest.fn(),
  getState: jest.fn(),
  setParams: jest.fn(),
  setOptions: jest.fn(),
  addListener: jest.fn(),
  removeListener: jest.fn(),
  replace: jest.fn(),
  push: jest.fn(),
  pop: jest.fn(),
  popToTop: jest.fn(),
  preload: jest.fn(),
} as any;

describe('navigation utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should navigate to the Learn tab', () => {
    navigateToLearnTab(mockNavigation);
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          index: 0,
          routes: [
            expect.objectContaining({
              name: SCREEN_NAMES.CALL_LOG,
              state: expect.objectContaining({
                routes: [
                  expect.objectContaining({
                    name: SCREEN_NAMES.BOTTOM_TABS,
                    state: expect.objectContaining({
                      index: 0, // Learn tab index
                      routes: expect.arrayContaining([
                        expect.objectContaining({name: SCREEN_NAMES.LEARN}),
                        expect.objectContaining({name: SCREEN_NAMES.CALL_LOG}),
                        expect.objectContaining({
                          name: SCREEN_NAMES.USER_ANALYTICS,
                        }),
                        expect.objectContaining({name: SCREEN_NAMES.SEARCH}),
                        expect.objectContaining({name: SCREEN_NAMES.COMMUNITY}),
                      ]),
                    }),
                  }),
                ],
              }),
            }),
          ],
        }),
      }),
    );
  });

  it('should navigate to the Call Log tab', () => {
    navigateToCallLogTab(mockNavigation);
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          index: 0,
          routes: expect.arrayContaining([
            expect.objectContaining({
              name: SCREEN_NAMES.CALL_LOG,
              state: expect.objectContaining({
                routes: expect.arrayContaining([
                  expect.objectContaining({
                    name: SCREEN_NAMES.BOTTOM_TABS,
                    state: expect.objectContaining({
                      index: expect.any(Number),
                      routes: expect.arrayContaining([
                        expect.objectContaining({name: SCREEN_NAMES.LEARN}),
                      ]),
                    }),
                  }),
                ]),
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it('should navigate to the Community tab', () => {
    navigateToCommunityTab(mockNavigation);
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          index: 0,
          routes: [
            expect.objectContaining({
              name: SCREEN_NAMES.CALL_LOG,
              state: expect.objectContaining({
                routes: [
                  expect.objectContaining({
                    name: SCREEN_NAMES.BOTTOM_TABS,
                    state: expect.objectContaining({
                      index: 4, // Community tab index
                      routes: expect.arrayContaining([
                        expect.objectContaining({name: SCREEN_NAMES.CALL_LOG}),
                        expect.objectContaining({
                          name: SCREEN_NAMES.USER_ANALYTICS,
                        }),
                        expect.objectContaining({name: SCREEN_NAMES.SEARCH}),
                        expect.objectContaining({name: SCREEN_NAMES.LEARN}),
                        expect.objectContaining({name: SCREEN_NAMES.COMMUNITY}),
                      ]),
                    }),
                  }),
                ],
              }),
            }),
          ],
        }),
      }),
    );
  });

  it('should navigate to the Search tab', () => {
    navigateToSearchTab(mockNavigation);
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          index: 0,
          routes: [
            expect.objectContaining({
              name: SCREEN_NAMES.CALL_LOG,
              state: expect.objectContaining({
                routes: [
                  expect.objectContaining({
                    name: SCREEN_NAMES.BOTTOM_TABS,
                    state: expect.objectContaining({
                      index: 3, // Search tab index
                      routes: expect.arrayContaining([
                        expect.objectContaining({name: SCREEN_NAMES.CALL_LOG}),
                        expect.objectContaining({
                          name: SCREEN_NAMES.USER_ANALYTICS,
                        }),
                        expect.objectContaining({name: SCREEN_NAMES.SEARCH}),
                        expect.objectContaining({name: SCREEN_NAMES.LEARN}),
                        expect.objectContaining({name: SCREEN_NAMES.COMMUNITY}),
                      ]),
                    }),
                  }),
                ],
              }),
            }),
          ],
        }),
      }),
    );
  });

  it('should navigate to the User Analytics tab', () => {
    navigateToUserAnalyticsTab(mockNavigation);
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          index: 0,
          routes: [
            expect.objectContaining({
              name: SCREEN_NAMES.CALL_LOG,
              state: expect.objectContaining({
                routes: [
                  expect.objectContaining({
                    name: SCREEN_NAMES.BOTTOM_TABS,
                    state: expect.objectContaining({
                      index: 2, // User Analytics tab index
                      routes: expect.arrayContaining([
                        expect.objectContaining({name: SCREEN_NAMES.CALL_LOG}),
                        expect.objectContaining({
                          name: SCREEN_NAMES.USER_ANALYTICS,
                        }),
                        expect.objectContaining({name: SCREEN_NAMES.SEARCH}),
                        expect.objectContaining({name: SCREEN_NAMES.LEARN}),
                        expect.objectContaining({name: SCREEN_NAMES.COMMUNITY}),
                      ]),
                    }),
                  }),
                ],
              }),
            }),
          ],
        }),
      }),
    );
  });
});

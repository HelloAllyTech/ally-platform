import {SCREEN_NAMES} from '@/constants';

import {
  handleReminderNavigation,
  isReminderNotification,
} from '../notificationNavigation';

describe('isReminderNotification', () => {
  it('recognises engagement-reminder payloads', () => {
    expect(isReminderNotification({type: 'ENGAGEMENT_REMINDER'})).toBe(true);
  });

  it('rejects other payloads', () => {
    expect(isReminderNotification({type: 'SOMETHING_ELSE'})).toBe(false);
    expect(isReminderNotification(undefined)).toBe(false);
    expect(isReminderNotification({})).toBe(false);
  });
});

describe('handleReminderNavigation', () => {
  const makeNavigationRef = (currentRouteName?: string) =>
    ({
      isReady: jest.fn().mockReturnValue(true),
      getCurrentRoute: jest
        .fn()
        .mockReturnValue(
          currentRouteName ? {name: currentRouteName} : undefined,
        ),
      navigate: jest.fn(),
      addListener: jest.fn().mockReturnValue(jest.fn()),
    }) as any;

  it('navigates to the Notifications screen by default', () => {
    const navigationRef = makeNavigationRef(SCREEN_NAMES.CALL_LOG);
    handleReminderNavigation(navigationRef, {type: 'ENGAGEMENT_REMINDER'});
    expect(navigationRef.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.NOTIFICATIONS,
    );
  });

  it('honours a Simulations screen hint', () => {
    const navigationRef = makeNavigationRef(SCREEN_NAMES.CALL_LOG);
    handleReminderNavigation(navigationRef, {
      type: 'ENGAGEMENT_REMINDER',
      screen: SCREEN_NAMES.SIMULATIONS,
    });
    expect(navigationRef.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.SIMULATIONS,
    );
  });

  it('falls back to Notifications for unknown screen hints', () => {
    const navigationRef = makeNavigationRef(SCREEN_NAMES.CALL_LOG);
    handleReminderNavigation(navigationRef, {
      type: 'ENGAGEMENT_REMINDER',
      screen: 'NotARealScreen',
    });
    expect(navigationRef.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.NOTIFICATIONS,
    );
  });

  it('waits for the navigator to leave SPLASH before navigating', () => {
    const navigationRef = makeNavigationRef(SCREEN_NAMES.SPLASH);
    handleReminderNavigation(navigationRef, {type: 'ENGAGEMENT_REMINDER'});
    expect(navigationRef.navigate).not.toHaveBeenCalled();
    expect(navigationRef.addListener).toHaveBeenCalledWith(
      'state',
      expect.any(Function),
    );

    // Simulate leaving SPLASH.
    navigationRef.getCurrentRoute.mockReturnValue({
      name: SCREEN_NAMES.CALL_LOG,
    });
    const stateListener = navigationRef.addListener.mock.calls[0][1];
    stateListener();
    expect(navigationRef.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.NOTIFICATIONS,
    );
  });

  it('does nothing when the navigator is not ready', () => {
    const navigationRef = makeNavigationRef(SCREEN_NAMES.CALL_LOG);
    navigationRef.isReady.mockReturnValue(false);
    handleReminderNavigation(navigationRef, {type: 'ENGAGEMENT_REMINDER'});
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });
});

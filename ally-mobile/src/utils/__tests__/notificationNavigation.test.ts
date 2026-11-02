import {SCREEN_NAMES} from '@/constants';

import {
  getDebriefNotificationSessionId,
  handleDebriefNavigation,
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

describe('getDebriefNotificationSessionId', () => {
  it('reads the session from a pushed DEBRIEF_READY / DEBRIEF_REVIEWED payload', () => {
    expect(
      getDebriefNotificationSessionId({
        type: 'DEBRIEF_READY',
        screen: 'SimulationFeedback',
        scenarioSessionId: 'sess-1',
      }),
    ).toBe('sess-1');
    expect(
      getDebriefNotificationSessionId({
        type: 'DEBRIEF_REVIEWED',
        scenarioSessionId: 42,
      }),
    ).toBe('42');
  });

  it('takes the type separately for an in-app feed item', () => {
    expect(
      getDebriefNotificationSessionId(
        {screen: 'SimulationFeedback', scenarioSessionId: 'sess-2'},
        'DEBRIEF_REVIEWED',
      ),
    ).toBe('sess-2');
  });

  it('ignores other types and payloads without a session', () => {
    expect(
      getDebriefNotificationSessionId({
        type: 'ENGAGEMENT_REMINDER',
        scenarioSessionId: 'sess-1',
      }),
    ).toBeUndefined();
    expect(
      getDebriefNotificationSessionId({type: 'DEBRIEF_READY'}),
    ).toBeUndefined();
    expect(
      getDebriefNotificationSessionId({
        type: 'DEBRIEF_READY',
        scenarioSessionId: '',
      }),
    ).toBeUndefined();
    expect(getDebriefNotificationSessionId(undefined)).toBeUndefined();
  });
});

describe('handleDebriefNavigation', () => {
  const makeNavigationRef = (currentRouteName?: string) =>
    ({
      isReady: jest.fn().mockReturnValue(true),
      getCurrentRoute: jest
        .fn()
        .mockReturnValue(
          currentRouteName ? {name: currentRouteName} : undefined,
        ),
      dispatch: jest.fn(),
      addListener: jest.fn().mockReturnValue(jest.fn()),
    }) as any;

  const pushFeedback = {
    type: 'PUSH',
    payload: {
      name: SCREEN_NAMES.SIMULATION_FEEDBACK,
      params: {scenarioSessionId: 'sess-1'},
    },
  };

  it('pushes the session’s feedback screen, which opens on Debrief', () => {
    const navigationRef = makeNavigationRef(SCREEN_NAMES.CALL_LOG);
    handleDebriefNavigation(navigationRef, 'sess-1');
    expect(navigationRef.dispatch).toHaveBeenCalledWith(pushFeedback);
  });

  it('waits for the navigator to leave SPLASH before navigating', () => {
    const navigationRef = makeNavigationRef(SCREEN_NAMES.SPLASH);
    handleDebriefNavigation(navigationRef, 'sess-1');
    expect(navigationRef.dispatch).not.toHaveBeenCalled();

    navigationRef.getCurrentRoute.mockReturnValue({
      name: SCREEN_NAMES.CALL_LOG,
    });
    const stateListener = navigationRef.addListener.mock.calls[0][1];
    stateListener();
    expect(navigationRef.dispatch).toHaveBeenCalledWith(pushFeedback);
  });

  it('does nothing when the navigator is not ready', () => {
    const navigationRef = makeNavigationRef(SCREEN_NAMES.CALL_LOG);
    navigationRef.isReady.mockReturnValue(false);
    handleDebriefNavigation(navigationRef, 'sess-1');
    expect(navigationRef.dispatch).not.toHaveBeenCalled();
  });
});

import {useCallback, useEffect, useMemo, useRef} from 'react';
import notifee from '@notifee/react-native';
import {
  createNavigationContainerRef,
  NavigationContainer,
  NavigationContainerRef,
  TabActions,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {Linking} from 'react-native';
import {useSelector} from 'react-redux';

import {env} from '@/config/env';
import {LEADERBOARD_NOTIFICATION_ID, SCREEN_NAMES} from '@/constants';
import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {USER_PERMISSIONS} from '@/constants/permissions';
import {
  useCounselorChat,
  useNavigationAwareCounselorChat,
  useSocketConnection,
  useUser,
} from '@/hooks';
import {
  AchievementsScreen,
  BreathingExerciseScreen,
  BreathingScreen,
  BugReportScreen,
  CallSummaryScreen,
  CaseDetailsScreen,
  CompleteProfileScreen,
  CourseItemPlayerScreen,
  CourseOverviewScreen,
  CourseProgressScreen,
  ListeningScreen,
  NotificationsScreen,
  ProfileSettingsScreen,
  ProgressScreen,
  ReactionsScreen,
  ReviewDetailsScreen,
  ScribeReviewDetailsScreen,
  ShareCallLogScreen,
  ShareSimulationScreen,
  SimulationAssistantScreen,
  SimulationDetailsScreen,
  SimulationFeedbackScreen,
  SimulationPathDetailsScreen,
  SimulationsScreen,
  SplashScreen,
  SuspendedAccountScreen,
} from '@/screens';
import {
  createAndroidChannel,
  EventType,
  requestNotificationPermission,
  scheduleWeeklyLeaderboardNotification,
} from '@/services/notificationService';
import {
  createRemindersChannel,
  registerDeviceForPush,
  subscribeToForegroundMessages,
  subscribeToTokenRefresh,
} from '@/services/pushNotificationService';
import {useLazyGetSummaryFieldsQuery} from '@/services/settingsApi';
import {AppRootState, store} from '@/store/store';
import {SocketEvent} from '@/types';
import {logger} from '@/utils';
import {getItem, setItem} from '@/utils/asyncStorage';
import {
  getCallIdFromUrl,
  getCourseIdFromUrl,
  isCourseLink,
  isSupportedDeepLink,
  navigateToCallSummaryOrLog,
} from '@/utils/deeplink';
import {
  handleReminderNavigation,
  isReminderNotification,
} from '@/utils/notificationNavigation';

import {DrawerNavigator} from './DrawerNavigator';
import type {RootStackParamList, RouteNames} from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

// This component ensures the counselor chat subscription has access to navigation
const NavigationContent = ({
  navigationRef,
}: {
  navigationRef: NavigationContainerRef<RootStackParamList>;
}) => {
  const {userData, isAuthenticated} = useUser();
  const permissions = useSelector((s: AppRootState) => s.user.permissions);
  const pendingItemIdRef = useRef<number | undefined>(undefined);
  const deepLinkInProgressRef = useRef<boolean>(false);
  // A course share link (`/course/:trackId`) waiting for the learner to be
  // signed in and past the post-login routing (Splash, CompleteProfile).
  const pendingCourseIdRef = useRef<string | undefined>(undefined);
  // The launch URL is re-read whenever the link effect re-subscribes; a
  // course link must open once, not every time summary fields reload.
  const launchCourseUrlHandledRef = useRef<boolean>(false);
  const [
    getSummaryFields,
    {data: summaryFields, isLoading: summaryFieldsLoading},
  ] = useLazyGetSummaryFieldsQuery();

  useEffect(() => {
    if (isAuthenticated) {
      getSummaryFields();
    }
  }, [isAuthenticated, getSummaryFields]);

  const isDeepLinkInProgress = useMemo(
    () =>
      pendingItemIdRef.current !== undefined || deepLinkInProgressRef.current,
    [],
  );

  const {checkCounselorChat} = useCounselorChat({
    onActiveChatFound: () => {
      if (isDeepLinkInProgress) {
        return;
      }
      if (
        (navigationRef?.getCurrentRoute()?.name as RouteNames) !==
        SCREEN_NAMES.LISTENING
      ) {
        navigationRef.reset({
          index: 1,
          routes: [
            {name: SCREEN_NAMES.CALL_LOG},
            {name: SCREEN_NAMES.LISTENING},
          ],
        });
      }
    },
    onNoActiveChatFound: () => {
      const currentRoute = navigationRef?.getCurrentRoute()?.name as RouteNames;
      if (isDeepLinkInProgress) {
        return;
      }
      if (currentRoute === SCREEN_NAMES.CALL_SUMMARY) {
        return;
      }
      if (currentRoute === SCREEN_NAMES.SPLASH) {
        navigationRef.reset({
          index: 0,
          routes: [{name: SCREEN_NAMES.CALL_LOG}],
        });
      }
    },
    getCurrentRoute: () => navigationRef?.getCurrentRoute()?.name,
  });

  // Single subscription that's aware of the current screen
  useNavigationAwareCounselorChat(navigationRef);

  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.USER_JOINED]: async () => {
        try {
          checkCounselorChat();
        } catch (error) {
          logger.error(`Error in USER_JOINED handler: ${error}`);
        }
      },
    }),
    [checkCounselorChat],
  );

  useSocketConnection({
    path: env.CLOUD_TELEPHONY_PATH,
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
  });

  // There is deliberately NO app-wide socket on the microphone namespace. One
  // used to live here, so every counselor held two connections to
  // `/microphone-chat` at once — this one for the whole life of the app, plus
  // the listening screen's — and the server opened a session for each. It bought
  // only a faster pickup of a scribe session started on another device, which
  // the foreground check in useCounselorChat already covers, and it cost a
  // second session for the janitor and the disconnect handler to disagree over
  // while a recording was live. Conference calls keep their app-wide socket
  // above: they are answered from the phone with no screen already open.

  useEffect(() => {
    const navigateToCallSummary = (callId: number) => {
      deepLinkInProgressRef.current = true;
      if (!isAuthenticated || summaryFieldsLoading || !summaryFields) {
        pendingItemIdRef.current = callId;
        return;
      }
      navigateToCallSummaryOrLog(navigationRef, callId, true);
      deepLinkInProgressRef.current = false;
      pendingItemIdRef.current = undefined;
    };

    const handleURL = (url?: string | null, isLaunchUrl = false) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        if (isSupportedDeepLink(parsed) && isCourseLink(parsed)) {
          if (isLaunchUrl) {
            if (launchCourseUrlHandledRef.current) return;
            launchCourseUrlHandledRef.current = true;
          }
          const trackId = getCourseIdFromUrl(parsed);
          if (trackId) {
            pendingCourseIdRef.current = trackId;
            openPendingCourse();
          }
          return;
        }
        if (isSupportedDeepLink(parsed)) {
          const callId = getCallIdFromUrl(parsed);
          if (callId) {
            navigateToCallSummary(callId);
          }
        }
      } catch {
        logger.error(`Error handling deep link: ${url}`);
      }
    };

    Linking.getInitialURL().then(url => handleURL(url, true));
    const sub = Linking.addEventListener('url', e => handleURL(e.url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, navigationRef, summaryFieldsLoading, summaryFields]);

  /**
   * Opens a pending course link once the learner can see it: signed in, and
   * past Splash/CompleteProfile, whose own post-login `replace` would
   * otherwise swap the course straight back out. Signed out, the link waits
   * through login (in memory — a killed app drops it, as summary links do).
   * Access is the overview's to decide: a course that is not theirs shows
   * the "not available" state there.
   */
  const openPendingCourse = useCallback(() => {
    const trackId = pendingCourseIdRef.current;
    if (!trackId || !isAuthenticated || !navigationRef.isReady()) return;
    const current = navigationRef.getCurrentRoute()?.name as RouteNames;
    if (
      current === SCREEN_NAMES.SPLASH ||
      current === SCREEN_NAMES.COMPLETE_PROFILE
    ) {
      return;
    }
    pendingCourseIdRef.current = undefined;
    // A live session the app routed a counsellor back into outranks a link:
    // drop it rather than pull them out, or spring it on them afterwards.
    if (current === SCREEN_NAMES.LISTENING) return;
    navigationRef.navigate(SCREEN_NAMES.COURSE_OVERVIEW, {trackId});
  }, [isAuthenticated, navigationRef]);

  useEffect(() => {
    openPendingCourse();
    return navigationRef.addListener('state', openPendingCourse);
  }, [openPendingCourse, navigationRef]);

  // If dependencies flip true while a deep link is pending, handle it now
  useEffect(() => {
    if (
      isAuthenticated &&
      !summaryFieldsLoading &&
      summaryFields &&
      pendingItemIdRef.current !== undefined
    ) {
      const itemId = pendingItemIdRef.current;
      pendingItemIdRef.current = undefined;
      const callId = itemId ? Number(itemId) : undefined;
      if (callId) {
        navigateToCallSummaryOrLog(navigationRef, callId, true);
      }
      deepLinkInProgressRef.current = false;
    }
  }, [isAuthenticated, summaryFieldsLoading, summaryFields, navigationRef]);

  const navigateToLeaderboard = useCallback(() => {
    if (!navigationRef.isReady()) return;
    navigationRef.dispatch(TabActions.jumpTo(SCREEN_NAMES.LEADERBOARD));
  }, [navigationRef]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      !permissions.includes(USER_PERMISSIONS.VIEW_COMMUNITY_LEADERBOARD)
    )
      return;
    (async () => {
      const enabled = await getItem<boolean>(
        AsyncStorageKeys.LEADERBOARD_NOTIFICATION_ENABLED,
      );
      // null means never set — treat as default ON
      if (enabled === null || enabled === true) {
        await createAndroidChannel();
        await requestNotificationPermission();
        await scheduleWeeklyLeaderboardNotification();
      }
    })();
  }, [isAuthenticated, permissions]);

  // Server push (FCM engagement reminders): register the device token once
  // authenticated, re-register on token rotation, and render foreground
  // data-only messages through Notifee.
  useEffect(() => {
    if (!isAuthenticated) return;
    let unsubscribeTokenRefresh: (() => void) | undefined;
    let unsubscribeForeground: (() => void) | undefined;
    (async () => {
      await createRemindersChannel();
      await requestNotificationPermission();
      await registerDeviceForPush(store.dispatch);
      unsubscribeTokenRefresh = subscribeToTokenRefresh(store.dispatch);
      unsubscribeForeground = subscribeToForegroundMessages();
    })();
    return () => {
      unsubscribeTokenRefresh?.();
      unsubscribeForeground?.();
    };
  }, [isAuthenticated]);

  // Handle notification press when app is in the foreground
  useEffect(() => {
    return notifee.onForegroundEvent(({type, detail}) => {
      if (type !== EventType.PRESS) return;
      if (detail.notification?.id === LEADERBOARD_NOTIFICATION_ID) {
        navigateToLeaderboard();
        return;
      }
      if (isReminderNotification(detail.notification?.data)) {
        handleReminderNavigation(navigationRef, detail.notification?.data);
      }
    });
  }, [navigateToLeaderboard, navigationRef]);

  // Handle notification press when app was killed (initial notification)
  useEffect(() => {
    if (!isAuthenticated) return;
    notifee.getInitialNotification().then(async initialNotification => {
      if (!initialNotification) return;

      // Engagement reminders (server push, rendered via Notifee).
      if (isReminderNotification(initialNotification.notification?.data)) {
        handleReminderNavigation(
          navigationRef,
          initialNotification.notification?.data,
        );
        return;
      }

      if (
        initialNotification?.notification?.id !== LEADERBOARD_NOTIFICATION_ID
      ) {
        return;
      }

      const scheduledAt = initialNotification.notification.data?.scheduledAt as
        | string
        | undefined;
      const lastHandled = await getItem<string>(
        AsyncStorageKeys.LEADERBOARD_NOTIF_HANDLED_TS,
      );
      if (scheduledAt && lastHandled === scheduledAt) {
        return; // Already navigated for this notification instance
      }
      await setItem(
        AsyncStorageKeys.LEADERBOARD_NOTIF_HANDLED_TS,
        scheduledAt ?? String(Date.now()),
      );

      // Navigate — wait for the tab navigator to mount if still on SPLASH
      const doNavigate = () => {
        const currentRoute = navigationRef.getCurrentRoute()?.name;
        if (currentRoute && currentRoute !== SCREEN_NAMES.SPLASH) {
          navigateToLeaderboard();
          return;
        }
        const unsubscribe = navigationRef.addListener('state', () => {
          const route = navigationRef.getCurrentRoute()?.name;
          if (route && route !== SCREEN_NAMES.SPLASH) {
            unsubscribe();
            navigateToLeaderboard();
          }
        });
      };
      doNavigate();
    });
  }, [isAuthenticated, navigateToLeaderboard, navigationRef]);

  return (
    <Stack.Navigator
      initialRouteName={SCREEN_NAMES.SPLASH}
      screenOptions={{
        headerShown: false,
      }}>
      {isAuthenticated ? (
        <>
          <Stack.Screen
            name={SCREEN_NAMES.CALL_LOG}
            children={() => <DrawerNavigator />}
          />
          <Stack.Screen
            name={SCREEN_NAMES.LISTENING}
            component={ListeningScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.CALL_SUMMARY}
            component={CallSummaryScreen}
            options={{gestureEnabled: false}}
          />
          <Stack.Screen
            name={SCREEN_NAMES.BREATHING}
            component={BreathingScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.BREATHING_EXERCISE}
            component={BreathingExerciseScreen}
            options={{headerShown: false, animation: 'fade'}}
          />
          <Stack.Screen
            name={SCREEN_NAMES.SIMULATIONS}
            component={SimulationsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.SIMULATION_DETAILS}
            component={SimulationDetailsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.SIMULATION_PATH_DETAILS}
            component={SimulationPathDetailsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.CASE_DETAILS}
            component={CaseDetailsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.COURSE_OVERVIEW}
            component={CourseOverviewScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.COURSE_ITEM_PLAYER}
            component={CourseItemPlayerScreen}
            options={{gestureEnabled: false}}
          />
          <Stack.Screen
            name={SCREEN_NAMES.COURSE_PROGRESS}
            component={CourseProgressScreen}
          />
          <Stack.Screen name={SCREEN_NAMES.SPLASH} component={SplashScreen} />
          <Stack.Screen
            name={SCREEN_NAMES.COMPLETE_PROFILE}
            component={CompleteProfileScreen}
            options={{gestureEnabled: false}}
          />
          <Stack.Screen
            name={SCREEN_NAMES.SIMULATION_ASSISTANT}
            component={SimulationAssistantScreen}
            options={{gestureEnabled: false}}
          />
          <Stack.Screen
            name={SCREEN_NAMES.SIMULATION_FEEDBACK}
            component={SimulationFeedbackScreen}
            options={{gestureEnabled: false}}
          />
          <Stack.Screen
            name={SCREEN_NAMES.ACHIEVEMENTS}
            component={AchievementsScreen}
          />
          {/* Reached by tapping the persistent level ring in the shared header, which
              is the entry point on every screen. Deliberately a stack screen rather
              than a ninth bottom tab: the tab bar is already at eight, and the widget
              is the one-tap route this feature is built around. */}
          <Stack.Screen
            name={SCREEN_NAMES.PROGRESS}
            component={ProgressScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.PROFILE_SETTINGS}
            component={ProfileSettingsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.BUG_REPORT}
            component={BugReportScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.REACTIONS}
            component={ReactionsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.REVIEW_DETAILS}
            component={ReviewDetailsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.SCRIBE_REVIEW_DETAILS}
            component={ScribeReviewDetailsScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.SHARE_CALL_LOG}
            component={ShareCallLogScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.SHARE_SIMULATION}
            component={ShareSimulationScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.NOTIFICATIONS}
            component={NotificationsScreen}
          />
        </>
      ) : (
        <>
          <Stack.Screen name={SCREEN_NAMES.SPLASH} component={SplashScreen} />
          <Stack.Screen
            name={SCREEN_NAMES.SUSPENDED_ACCOUNT}
            component={SuspendedAccountScreen}
          />
        </>
      )}
    </Stack.Navigator>
  );
};

const navigationRef = createNavigationContainerRef<RootStackParamList>();

export const navigateToLeaderboard = () => {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(TabActions.jumpTo(SCREEN_NAMES.LEADERBOARD));
};

export const RootNavigator = () => {
  return (
    <NavigationContainer ref={navigationRef}>
      <NavigationContent navigationRef={navigationRef} />
    </NavigationContainer>
  );
};

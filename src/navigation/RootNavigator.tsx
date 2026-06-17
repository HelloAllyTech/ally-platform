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
  BreathingScreen,
  CallSummaryScreen,
  CaseDetailsScreen,
  CompleteProfileScreen,
  ListeningScreen,
  ProfileSettingsScreen,
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
import {useLazyGetSummaryFieldsQuery} from '@/services/settingsApi';
import {AppRootState} from '@/store/store';
import {SocketEvent} from '@/types';
import {logger} from '@/utils';
import {getItem, setItem} from '@/utils/asyncStorage';
import {
  getCallIdFromUrl,
  isSupportedDeepLink,
  navigateToCallSummaryOrLog,
} from '@/utils/deeplink';

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

  useSocketConnection({
    path: env.MICROPHONE_SOCKET_PATH,
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
  });

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

    const handleURL = (url?: string | null) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
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

    Linking.getInitialURL().then(handleURL);
    const sub = Linking.addEventListener('url', e => handleURL(e.url));
    return () => sub.remove();
  }, [isAuthenticated, navigationRef, summaryFieldsLoading, summaryFields]);

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

  // Handle notification press when app is in the foreground
  useEffect(() => {
    return notifee.onForegroundEvent(({type, detail}) => {
      if (
        type === EventType.PRESS &&
        detail.notification?.id === LEADERBOARD_NOTIFICATION_ID
      ) {
        navigateToLeaderboard();
      }
    });
  }, [navigateToLeaderboard]);

  // Handle notification press when app was killed (initial notification)
  useEffect(() => {
    if (!isAuthenticated) return;
    notifee.getInitialNotification().then(async initialNotification => {
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
          <Stack.Screen
            name={SCREEN_NAMES.PROFILE_SETTINGS}
            component={ProfileSettingsScreen}
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

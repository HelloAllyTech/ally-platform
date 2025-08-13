import {useMemo} from 'react';
import {
  NavigationContainer,
  NavigationContainerRef,
  useNavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import {env} from '@/config/env';
import {SCREEN_NAMES} from '@/constants';
import {
  useCounselorChat,
  useNavigationAwareCounselorChat,
  useSocketConnection,
  useUser,
} from '@/hooks';
import {
  BreathingScreen,
  CallSummaryScreen,
  ListeningScreen,
  SimulationAssistantScreen,
  SimulationDetailsScreen,
  SimulationFeedbackScreen,
  SimulationsScreen,
  SplashScreen,
} from '@/screens';
import {SocketEvent, UserRole} from '@/types';
import {logger} from '@/utils';

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
  const isCounselor = userData?.role === UserRole.COUNSELOR;

  const {checkCounselorChat} = useCounselorChat({
    onActiveChatFound: () => {
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
      navigationRef.reset({
        index: 0,
        routes: [{name: SCREEN_NAMES.CALL_LOG}],
      });
    },
    getCurrentRoute: () => navigationRef?.getCurrentRoute()?.name,
  });

  // Single subscription that's aware of the current screen
  useNavigationAwareCounselorChat(navigationRef);

  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.USER_JOINED]: async () => {
        try {
          if (userData?.role === UserRole.COUNSELOR) {
            checkCounselorChat();
          }
        } catch (error) {
          logger.error(`Error in USER_JOINED handler: ${error}`);
        }
      },
    }),
    [checkCounselorChat, userData?.role],
  );

  useSocketConnection({
    path: env.WEBRTC_SOCKET_PATH,
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
  });

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
            children={() => <DrawerNavigator hideTabBar={!isCounselor} />}
          />
          <Stack.Screen
            name={SCREEN_NAMES.LISTENING}
            component={ListeningScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.CALL_SUMMARY}
            component={CallSummaryScreen}
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
          <Stack.Screen name={SCREEN_NAMES.SPLASH} component={SplashScreen} />
          <Stack.Screen
            name={SCREEN_NAMES.SIMULATION_ASSISTANT}
            component={SimulationAssistantScreen}
          />
          <Stack.Screen
            name={SCREEN_NAMES.SIMULATION_FEEDBACK}
            component={SimulationFeedbackScreen}
          />
        </>
      ) : (
        <Stack.Screen name={SCREEN_NAMES.SPLASH} component={SplashScreen} />
      )}
    </Stack.Navigator>
  );
};

export const RootNavigator = () => {
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  return (
    <NavigationContainer ref={navigationRef}>
      <NavigationContent navigationRef={navigationRef} />
    </NavigationContainer>
  );
};

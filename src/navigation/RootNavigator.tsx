import {useMemo} from 'react';
import {
  NavigationContainer,
  NavigationContainerRef,
  useNavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import {env} from '@/config/env';
import {
  useCounselorChat,
  useNavigationAwareCounselorChat,
  useSocketConnection,
  useUser,
} from '@/hooks';
import {
  BreathingScreen,
  CallLogScreen,
  CallSummaryScreen,
  ListeningScreen,
  LiveKitTestScreen,
  SimulationsScreen,
  SplashScreen,
} from '@/screens';
import {SocketEvent, UserRole} from '@/types';
import {logger} from '@/utils/logger';

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
        (navigationRef?.getCurrentRoute()?.name as RouteNames) !== 'Listening'
      ) {
        navigationRef.reset({
          index: 1,
          routes: [{name: 'Home'}, {name: 'Listening'}],
        });
      }
    },
    onNoActiveChatFound: () => {
      navigationRef.reset({
        index: 0,
        routes: [{name: 'Home'}],
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
      initialRouteName="Splash"
      screenOptions={{
        headerShown: false,
      }}>
      {isAuthenticated ? (
        <>
          <Stack.Screen
            name="Home"
            children={() => <DrawerNavigator hideTabBar={!isCounselor} />}
          />
          <Stack.Screen name="Listening" component={ListeningScreen} />
          <Stack.Screen name="CallSummary" component={CallSummaryScreen} />
          <Stack.Screen name="CallLog" component={CallLogScreen} />
          <Stack.Screen name="Breathing" component={BreathingScreen} />
          <Stack.Screen name="Simulations" component={SimulationsScreen} />
          <Stack.Screen name="LiveKitTest" component={LiveKitTestScreen} />
          <Stack.Screen name="Splash" component={SplashScreen} />
        </>
      ) : (
        <Stack.Screen name="Splash" component={SplashScreen} />
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

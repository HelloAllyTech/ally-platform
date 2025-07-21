import {useMemo} from 'react';
import {
  NavigationContainer,
  NavigationContainerRef,
  useNavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import {env} from '@/config/env';
import {useCounselorChat} from '@/hooks/useCounselorChat';
import {useNavigationAwareCounselorChat} from '@/hooks/useNavigationAwareCounselorChat';
import {useSocketConnection} from '@/hooks/useSocketConnection';
import {useUser} from '@/hooks/useUser';
import type {RootStackParamList, RouteNames} from '@/navigation/types';
import {
  BreathingScreen,
  CallLogScreen,
  CallSummaryScreen,
  ListeningScreen,
  SplashScreen,
} from '@/screens';
import {SocketEvent} from '@/types/message';
import {UserRole} from '@/types/user';
import {logger} from '@/utils/logger';

import {DrawerNavigator} from './DrawerNavigator';

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

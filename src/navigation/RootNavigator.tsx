import {
  NavigationContainer,
  NavigationContainerRef,
  useNavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import {useNavigationAwareCounselorChat} from '@/hooks/useNavigationAwareCounselorChat';
import {useUser} from '@/hooks/useUser';
import type {RootStackParamList} from '@/navigation/types';
import {
  BreathingScreen,
  CallLogScreen,
  CallSummaryScreen,
  ListeningScreen,
  SplashScreen,
} from '@/screens';
import {UserRole} from '@/types/user';

import {BottomTabs} from './tabNavigator';

const Stack = createNativeStackNavigator<RootStackParamList>();

// This component ensures the counselor chat subscription has access to navigation
const NavigationContent = ({
  navigationRef,
}: {
  navigationRef: NavigationContainerRef<RootStackParamList>;
}) => {
  // Single subscription that's aware of the current screen
  useNavigationAwareCounselorChat(navigationRef);

  const {userData} = useUser();
  const isCounselor = userData?.role === UserRole.COUNSELOR;

  return (
    <Stack.Navigator
      initialRouteName="Splash"
      screenOptions={{
        headerShown: false,
      }}>
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen
        name="Home"
        children={() => <BottomTabs hideTabBar={!isCounselor} />}
      />
      <Stack.Screen name="Listening" component={ListeningScreen} />
      <Stack.Screen name="CallSummary" component={CallSummaryScreen} />
      <Stack.Screen name="CallLog" component={CallLogScreen} />
      <Stack.Screen name="Breathing" component={BreathingScreen} />
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

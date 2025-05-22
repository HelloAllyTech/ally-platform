import {
  NavigationContainer,
  NavigationContainerRef,
  useNavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import {useNavigationAwareCounselorChat} from '@/hooks/useNavigationAwareCounselorChat';
import type {RootStackParamList} from '@/navigation/types';
import {
  CallLogScreen,
  CallSummaryScreen,
  ListeningScreen,
  SplashScreen,
} from '@/screens';

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

  return (
    <Stack.Navigator
      initialRouteName="Splash"
      screenOptions={{
        headerShown: false,
      }}>
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="Home" component={BottomTabs} />
      <Stack.Screen name="Listening" component={ListeningScreen} />
      <Stack.Screen name="CallSummary" component={CallSummaryScreen} />
      <Stack.Screen name="CallLog" component={CallLogScreen} />
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

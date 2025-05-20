import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import type {RootStackParamList} from '@/navigation/types';
import {
  CallLogScreen,
  CallSummaryScreen,
  ListeningScreen,
  SplashScreen,
} from '@/screens';

import {BottomTabs} from './tabNavigator';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  return (
    <NavigationContainer>
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
    </NavigationContainer>
  );
};

import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

export type RootStackParamList = {
  Splash: undefined;
  Home: {screen?: string; params?: {screen?: string}} | undefined;
  Listening: {isMicrophoneMode?: boolean} | undefined;
  CallSummary: {callId?: number} | undefined;
  CallLog: undefined;
  Breathing: undefined;
  LiveKitTest: undefined;
  Simulations: undefined;
};

export type DrawerParamList = {
  BottomTabs: {
    hideTabBar?: boolean;
  };
};

export type TabParamList = {
  HomeTab: undefined;
  CallLog: undefined;
  Community: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<
  TabParamList,
  T
>;

export type RouteNames = keyof RootStackParamList | keyof TabParamList;

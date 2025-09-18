import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {RoomData, Scenario} from '@/types/simulations';

export type RootStackParamList = {
  Splash: undefined;
  Listening: {isMicrophoneMode?: boolean} | undefined;
  CallSummary: {callId?: number; fromLogs?: boolean} | undefined;
  CallLog: undefined;
  Breathing: undefined;
  LiveKitTest: undefined;
  Simulations: undefined;
  SimulationDetails: {scenario: Scenario};
  SimulationAssistant: {roomData: RoomData; scenario?: Scenario};
  SimulationFeedback: {simulationId?: string; fromLogs?: boolean};
};

export type DrawerParamList = {
  BottomTabs: {
    hideTabBar?: boolean;
  };
};

export type TabParamList = {
  CallLog: undefined;
  Community: undefined;
  UserAnalytics: undefined;
  Search: undefined;
  Learn: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<
  TabParamList,
  T
>;

export type RouteNames = keyof RootStackParamList | keyof TabParamList;

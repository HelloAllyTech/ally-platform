import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {RoomCreationResponse, Scenario} from '@/types/simulations';

export type RootStackParamList = {
  Splash: undefined;
  Listening: {isMicrophoneMode?: boolean} | undefined;
  CallSummary: {callId?: number} | undefined;
  CallLog: undefined;
  Breathing: undefined;
  LiveKitTest: undefined;
  Simulations: undefined;
  SimulationDetails: {scenario: Scenario};
  SimulationAssistant: {roomData: RoomCreationResponse; scenario?: Scenario};
  SimulationFeedback: {simulationId?: number};
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

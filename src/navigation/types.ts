import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import type {ReviewType} from '@/contexts/ReviewApiContext';
import {Scenario, SessionData} from '@/types/simulations';

export type RootStackParamList = {
  Splash: undefined;
  SuspendedAccount: undefined;
  Listening: {isMicrophoneMode?: boolean} | undefined;
  CallSummary: {callId?: number; fromLogs?: boolean} | undefined;
  CallLog: undefined;
  Breathing: undefined;
  LiveKitTest: undefined;
  Simulations: undefined;
  SimulationDetails: {scenario: Scenario};
  SimulationPathDetails: {pathId: string};
  CaseDetails: {caseId: string};
  SimulationAssistant: {
    sessionData: SessionData;
    scenario?: Scenario;
    pathId?: string;
    caseId?: string;
    languageId?: number;
  };
  SimulationFeedback: {
    scenarioSessionId?: string;
    fromLogs?: boolean;
    pathId?: string;
    caseId?: string;
    languageId?: number;
  };
  Achievements: undefined;
  ProfileSettings: undefined;
  Reactions: {reviewId: string | number; reviewType?: ReviewType};
  ReviewDetails: {reviewId: string; isPrivate?: boolean};
  ScribeReviewDetails: {reviewId: string; isPrivate?: boolean};
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
  Leaderboard: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<
  TabParamList,
  T
>;

export type RouteNames = keyof RootStackParamList | keyof TabParamList;

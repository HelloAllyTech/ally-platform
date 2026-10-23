import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import type {ReviewType} from '@/contexts/ReviewApiContext';
import {ShareScreenSessionData} from '@/types';
import {BreathingExerciseContent} from '@/types/courses';
import {Scenario, SessionData} from '@/types/simulations';

export type RootStackParamList = {
  Splash: undefined;
  SuspendedAccount: undefined;
  CompleteProfile: undefined;
  Listening: {isMicrophoneMode?: boolean} | undefined;
  CallSummary: {callId?: number; fromLogs?: boolean} | undefined;
  CallLog: undefined;
  Breathing: undefined;
  BreathingExercise: {
    config: BreathingExerciseContent;
    itemId: string;
    trackId: string;
  };
  LiveKitTest: undefined;
  Simulations: undefined;
  SimulationDetails: {scenario: Scenario};
  SimulationPathDetails: {pathId: string};
  CaseDetails: {caseId: string};
  CourseOverview: {trackId: string};
  CourseItemPlayer: {
    trackId: string;
    itemId: string;
    /**
     * Deep-linked from a COURSE_DISCUSSION_REPLY notification — the reply
     * post to scroll to / highlight once the item's discussion loads.
     */
    highlightPostId?: string;
  };
  CourseProgress: {trackId: string};
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
  Progress: undefined;
  ProfileSettings: undefined;
  BugReport: undefined;
  Reactions: {reviewId: string | number; reviewType?: ReviewType};
  ReviewDetails: {reviewId: string; isPrivate?: boolean};
  ScribeReviewDetails: {reviewId: string; isPrivate?: boolean};
  ShareCallLog: {
    reviewId?: string;
    scribeSessionId?: number;
    sessionData: ShareScreenSessionData;
    isEditNote?: boolean;
    note?: string;
  };
  ShareSimulation: {
    reviewId?: string;
    scenarioSessionId?: string;
    scenarioData: ShareScreenSessionData;
    isEditNote?: boolean;
    note?: string;
  };
  Notifications: undefined;
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

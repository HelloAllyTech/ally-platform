import React from 'react';
import {render, fireEvent, waitFor} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {SimulationFeedbackScreen} from '../SimulationFeedbackScreen';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

let mockGoBack = jest.fn();
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({
    goBack: (...args: any[]) => mockGoBack(...args),
    navigate: jest.fn(),
    replace: jest.fn(),
    reset: jest.fn(),
  }),
  useHardwareBackPressHandler: () => {},
  useStartSimulation: () => ({
    startSimulation: jest.fn(),
    isCreatingRoom: false,
    isMicPermissionGranted: true,
    activeSimulationId: null,
    showActiveSimulationModal: false,
    closeActiveSimulationModal: jest.fn(),
    setShowActiveSimulationModal: jest.fn(),
  }),
  useTranslate: () => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  }),
  useToggleReviewPrivacy: () => ({handleTogglePrivate: jest.fn()}),
  useHideReviewDetails: () => ({hideReviewDetails: true}),
}));

// Mock Redux hooks
jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: any) => {
    // Mock user permissions state
    const mockState = {
      user: {
        permissions: ['edit:scenario-session', 'view:session-scenario:messages'],
      },
    };
    return selector(mockState);
  },
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    ArrowDown: () => <Text testID="arrow-down" />,
    ChevronDown: () => <Text testID="chevron-down" />,
    LeftArrowIcon: () => <Text testID="left-arrow-icon" />,
    CommentIcon: () => <Text testID="comment-icon" />,
    HelpIcon: () => <Text testID="help-icon" />,
    LightBulbIcon: () => <Text testID="lightbulb-icon" />,
    ThumbUpIcon: () => <Text testID="thumbup-icon" />,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View, TouchableOpacity, Text} = require('react-native');
  const showToastMock = jest.fn();
  return {
    Button: ({label, onPress}: any) => (
      <TouchableOpacity testID="primary-button" onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    FeedbackPopup: ({visible, onClose}: any) => (
      visible ? <View testID="feedback-popup" onTouchEnd={onClose} /> : null
    ),
    CustomTabs: ({tabs, activeTab, onTabChange}: any) => (
      <View testID="custom-tabs">
        {tabs?.map((tab: any, index: number) => (
          <TouchableOpacity
            key={index}
            testID={`tab-${index}`}
            onPress={() => onTabChange?.(index)}>
            <Text>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    ),
    CustomSwitch: ({onToggle, isEnabled}: any) => (
      <TouchableOpacity
        testID="custom-switch"
        onPress={() => onToggle?.(!isEnabled)}>
        <Text>{isEnabled ? 'ON' : 'OFF'}</Text>
      </TouchableOpacity>
    ),
    useToast: () => ({showToast: showToastMock}),
    __mocks__: {showToastMock},
  };
});

jest.mock('@/services', () => {
  const useLazyGetSimulationDetailsQuery = jest.fn(() => [
    jest.fn().mockResolvedValue({data: {details: {}}}),
    {
      data: {
        details: {summary: {}},
        score: 10,
        startedAt: '2024-01-01T00:00:00Z',
        endedAt: '2024-01-01T00:00:30Z',
        scenario: {title: 'Test'},
        events: [],
      },
      isLoading: false,
    },
  ]);
  const useLazyGetUpcomingScenarioQuery = jest.fn(() => [
    jest.fn(),
    {data: null},
  ]);
  return {
    __esModule: true,
    useAddSimulationFeedbackMutation: () => [
      jest.fn().mockResolvedValue({data: {success: true}}),
    ],
    useCreateReviewMutation: () => [
      jest.fn().mockResolvedValue({data: {success: true}}),
    ],
    useUpdateReviewStatusMutation: () => [
      jest.fn().mockResolvedValue({data: {success: true}}),
    ],
    useLazyGetSimulationDetailsQuery,
    useGetUpcomingScenarioQuery: jest.fn(() => ({
      data: null,
      fulfilledTimeStamp: 0,
    })),
    useLazyGetUpcomingScenarioQuery,
    useLazyGetReactionsCountQuery: () => [
      jest.fn().mockResolvedValue({data: {reactions: {}}}),
      {isLoading: false},
    ],
  };
});

jest.mock('@/services/simulationSummaryApi', () => ({
  useGetSimulationSkillsQuery: () => ({data: null, isLoading: false}),
}));

jest.mock('@/services/reviewsApi', () => ({
  useGetReviewByIdQuery: () => ({data: null, isLoading: false}),
}));

jest.mock('@/services/reviewThreadsApi', () => ({
  useLazyGetThreadsQuery: () => [
    jest.fn().mockResolvedValue({data: {data: []}}),
    {isLoading: false},
  ],
}));

jest.mock('@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    SimulationDetailsModal: ({visible}: any) =>
      visible ? <View testID="simulation-details-modal" /> : null,
  };
});

jest.mock('@/utils', () => ({
  formatDateTime: (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).replace(' at ', ' ');
  },
  formatDutationFromStartedAtAndEndedAt: () => '0:30',
  isMinutesPassed: () => true,
  isShortSession: () => false,
  navigateToLearnTab: jest.fn(),
}));

jest.mock('../components', () => {
  const React = require('react');
  const {TouchableOpacity, Text, View} = require('react-native');
  return {
    SummaryTab: ({onTryAnother}: any) => (
      <View testID="summary-tab">
        <TouchableOpacity testID="try-another-button" onPress={onTryAnother}>
          <Text>Try Another</Text>
        </TouchableOpacity>
      </View>
    ),
    TranscriptTab: () => <View testID="transcript-tab" />,
    AskAI: () => <View testID="ask-ai-tab" />,
    SessionSkills: () => <View testID="session-skills-tab" />,
    Reflection: () => <View testID="reflection-tab" />,
    UpNext: ({onFinish, onBack}: any) => (
      <View testID="up-next-tab">
        <TouchableOpacity testID="finish-button" onPress={onFinish}>
          <Text>Finish</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="back-button" onPress={onBack}>
          <Text>Back</Text>
        </TouchableOpacity>
      </View>
    ),
  };
});

describe('SimulationFeedbackScreen', () => {
  const renderWithProviders = (ui: React.ReactElement) =>
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        {ui}
      </SafeAreaProvider>,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('renders summary tab when data exists', () => {
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen
        navigation={{} as any}
        route={{params: {scenarioSessionId: '1'}} as any}
      />,
    );
    expect(getByTestId('summary-tab')).toBeTruthy();
  });

  it('renders try another button in summary tab', () => {
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    expect(getByTestId('try-another-button')).toBeTruthy();
  });

  it('renders summary tab even when details are missing', () => {
    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      jest.fn().mockResolvedValue({data: {details: null}}),
      {data: {details: null}, isLoading: false},
    ]);

    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    // Screen always renders SummaryTab; loading state is handled internally by SummaryTab
    expect(getByTestId('summary-tab')).toBeTruthy();
  });

  it('switches to transcript tab', async () => {
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1', fromLogs: true}} as any} />,
    );
    // Tab index 2 is TRANSCRIPTION (SUMMARY=0, ASK_AI=1, TRANSCRIPTION=2, SKILLS=3)
    fireEvent.press(getByTestId('tab-2'));
    await waitFor(() => {
      expect(getByTestId('transcript-tab')).toBeTruthy();
    });
  });

  it('shows up next tab when pathId is provided', async () => {
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1', pathId: 'path-1'}} as any} />,
    );
    // Tab index 5 is UP_NEXT (SUMMARY=0, ASK_AI=1, TRANSCRIPTION=2, SKILLS=3, REFLECTION=4, UP_NEXT=5)
    fireEvent.press(getByTestId('tab-5'));
    await waitFor(() => {
      expect(getByTestId('up-next-tab')).toBeTruthy();
    });
  });

  it('navigates back when fromLogs back button is pressed', () => {
    mockGoBack = jest.fn();

    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1', fromLogs: true}} as any} />,
    );

    fireEvent.press(getByTestId('left-arrow-icon'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('shows back arrow even when not from logs', () => {
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    expect(getByTestId('left-arrow-icon')).toBeTruthy();
  });

  it('renders tabs with correct count based on route params', () => {
    const {getByTestId, queryByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    // Without pathId/caseId: SUMMARY (0), ASK_AI (1), TRANSCRIPTION (2), SKILLS (3), REFLECTION (4)
    expect(getByTestId('tab-0')).toBeTruthy();
    expect(getByTestId('tab-1')).toBeTruthy();
    expect(getByTestId('tab-2')).toBeTruthy();
    expect(getByTestId('tab-3')).toBeTruthy();
    expect(getByTestId('tab-4')).toBeTruthy();
    expect(queryByTestId('tab-5')).toBeNull();
  });
});

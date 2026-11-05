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

let mockLanguage = 'en';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {resolvedLanguage: mockLanguage, language: mockLanguage},
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
    SessionRatingTrigger: () => <View testID="session-rating-trigger" />,
    useToast: () => ({showToast: showToastMock}),
    __mocks__: {showToastMock},
  };
});

const mockSimulationDetailsTrigger = jest.fn(() => ({
  unwrap: () =>
    Promise.resolve({
      scenario: {},
      details: {summary: {feedback: {positives: [], areas_of_growth: []}}},
    }),
}));
jest.mock('@/services', () => {
  const useLazyGetSimulationDetailsQuery = jest.fn(() => [
    mockSimulationDetailsTrigger,
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
    SummaryTab: () => <View testID="summary-tab" />,
    TranscriptTab: ({focusMessage}: any) => (
      <View testID="transcript-tab">
        <Text testID="transcript-focus-message-id">
          {focusMessage?.messageId ?? ''}
        </Text>
        <Text testID="transcript-focus-request-id">
          {String(focusMessage?.requestId ?? '')}
        </Text>
      </View>
    ),
    DebriefTab: ({onOpenMoment}: any) => (
      <View testID="debrief-tab">
        {onOpenMoment && (
          <>
            <TouchableOpacity
              testID="debrief-open-moment"
              onPress={() => onOpenMoment('msg-1')}>
              <Text>open moment</Text>
            </TouchableOpacity>
            {/* A second anchor so the tests can tell "the id travelled" apart
                from "some id travelled". */}
            <TouchableOpacity
              testID="debrief-open-moment-2"
              onPress={() => onOpenMoment('msg-2')}>
              <Text>open other moment</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    ),
    EventChecklist: () => <View testID="event-checklist" />,
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
    mockLanguage = 'en';
  });

  it('renders debrief tab when data exists', async () => {
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen
        navigation={{} as any}
        route={{params: {scenarioSessionId: '1'}} as any}
      />,
    );
    // Debrief is the landing tab now.
    fireEvent.press(getByTestId('tab-0'));
    await waitFor(() => {
      expect(getByTestId('debrief-tab')).toBeTruthy();
    });
  });

  it('renders try another button on the transcript tab', async () => {
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    // The floating "try another" button is hidden on Debrief (it has its own
    // bottom-pinned reply composer). Transcript is the only other tab now that
    // Skills is retired.
    fireEvent.press(getByTestId('tab-2'));
    await waitFor(() => {
      expect(getByTestId('primary-button')).toBeTruthy();
    });
  });

  it('renders debrief tab even when details are missing', async () => {
    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      jest.fn().mockResolvedValue({data: {details: null}}),
      {data: {details: null}, isLoading: false},
    ]);

    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    // DebriefTab always renders once selected; its loading/failed state is internal.
    fireEvent.press(getByTestId('tab-0'));
    await waitFor(() => {
      expect(getByTestId('debrief-tab')).toBeTruthy();
    });
  });

  it('switches to transcript tab', async () => {
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1', fromLogs: true}} as any} />,
    );
    // testIDs are fixed per tab, not per position: 'tab-2' is TRANSCRIPTION
    // (DEBRIEF=0, SKILLS=1, TRANSCRIPTION=2) whatever order they sit in.
    fireEvent.press(getByTestId('tab-2'));
    await waitFor(() => {
      expect(getByTestId('transcript-tab')).toBeTruthy();
    });
  });

  it('adds no Up next tab even when pathId is provided', async () => {
    // The legacy Up next tab was retired on 2026-08-31 along with Skills;
    // pathId/caseId now only pick the back-navigation target.
    const {queryByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1', pathId: 'path-1'}} as any} />,
    );

    expect(queryByTestId('tab-3')).toBeNull();
    expect(queryByTestId('up-next-tab')).toBeNull();
  });

  it('falls back to the first visible tab when debrief is turned off', async () => {
    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      mockSimulationDetailsTrigger,
      {
        data: {
          details: {summary: {}},
          score: 10,
          startedAt: '2024-01-01T00:00:00Z',
          endedAt: '2024-01-01T00:00:30Z',
          scenario: {
            title: 'Test',
            metadata: {
              feedbackTabs: {debrief: false, transcript: true},
            },
          },
          events: [],
        },
        isLoading: false,
      },
    ]);

    const {getByTestId, queryByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    // Debrief starts as the default activeTabKey, but it isn't in the visible
    // set here, so the screen falls through to Transcript without a tap.
    await waitFor(() => {
      expect(getByTestId('transcript-tab')).toBeTruthy();
    });
    expect(queryByTestId('debrief-tab')).toBeNull();
  });

  it('still shows the event checklist when only the debrief sub-tab is turned off', async () => {
    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      mockSimulationDetailsTrigger,
      {
        data: {
          details: {summary: {}},
          score: 10,
          startedAt: '2024-01-01T00:00:00Z',
          endedAt: '2024-01-01T00:00:30Z',
          scenario: {
            title: 'Test',
            metadata: {
              experienceMode: 'CHECKLIST',
              feedbackTabs: {debrief: false, transcript: true},
            },
          },
          events: [],
        },
        isLoading: false,
      },
    ]);

    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen
        navigation={{} as any}
        route={{params: {scenarioSessionId: '1'}} as any}
      />,
    );
    // The checklist used to only ever render inside the Debrief tab, so
    // turning that sub-tab off alone made it vanish even though Skills and
    // Transcript were still on — it must render independent of any one tab.
    await waitFor(() => {
      expect(getByTestId('event-checklist')).toBeTruthy();
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

  it('restarts feedback polling when the UI language changes', async () => {
    // An earlier test replaces this hook's return via mockReturnValue, which
    // clearAllMocks does not undo — pin it back to the shared trigger.
    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      mockSimulationDetailsTrigger,
      {data: {details: {summary: {}}}, isLoading: false},
    ]);
    // Build a fresh element each time — reusing the same element reference
    // makes React bail out of re-rendering the subtree on rerender.
    const makeScreen = () => (
      <SimulationFeedbackScreen
        navigation={{} as any}
        route={{params: {scenarioSessionId: '1'}} as any}
      />
    );
    const {rerender} = renderWithProviders(makeScreen());
    await waitFor(() => {
      expect(mockSimulationDetailsTrigger).toHaveBeenCalledTimes(1);
    });

    mockLanguage = 'hi';
    rerender(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        {makeScreen()}
      </SafeAreaProvider>,
    );
    await waitFor(() => {
      expect(mockSimulationDetailsTrigger).toHaveBeenCalledTimes(2);
    });
  });

  it('renders exactly two tabs: Debrief and Transcript', () => {
    const {getByTestId, queryByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    // testIDs are per tab, not per position: DEBRIEF (0), TRANSCRIPTION (2).
    // Skills (1) and Up next (3) were retired on 2026-08-31 and their ids are
    // deliberately not reused.
    expect(getByTestId('tab-0')).toBeTruthy();
    expect(getByTestId('tab-2')).toBeTruthy();
    expect(queryByTestId('tab-1')).toBeNull();
    expect(queryByTestId('tab-3')).toBeNull();
  });

  describe('debrief moment anchors', () => {
    // "See this moment" chips in the debrief note both switch to the
    // Transcript tab and ask it to scroll to that message (web parity).

    it('hands the anchored message id to the transcript tab', async () => {
      const {getByTestId} = renderWithProviders(
        <SimulationFeedbackScreen
          navigation={{} as any}
          route={{params: {scenarioSessionId: '1'}} as any}
        />,
      );

      fireEvent.press(getByTestId('tab-0'));
      fireEvent.press(getByTestId('debrief-open-moment-2'));

      await waitFor(() => {
        expect(getByTestId('transcript-tab')).toBeTruthy();
      });
      // The chip lands on the moment, not merely on the tab.
      expect(getByTestId('transcript-focus-message-id').props.children).toBe(
        'msg-2',
      );
      expect(getByTestId('transcript-focus-request-id').props.children).toBe(
        '1',
      );
    });

    it('raises a fresh request each time a moment is opened', async () => {
      const {getByTestId} = renderWithProviders(
        <SimulationFeedbackScreen
          navigation={{} as any}
          route={{params: {scenarioSessionId: '1'}} as any}
        />,
      );

      fireEvent.press(getByTestId('tab-0'));
      fireEvent.press(getByTestId('debrief-open-moment'));
      await waitFor(() => {
        expect(getByTestId('transcript-focus-request-id').props.children).toBe(
          '1',
        );
      });

      // Back to Debrief, then the same chip again: a learner who has scrolled
      // away should be taken back to the moment rather than ignored because
      // the id has not changed.
      fireEvent.press(getByTestId('tab-0'));
      fireEvent.press(getByTestId('debrief-open-moment'));

      await waitFor(() => {
        expect(getByTestId('transcript-focus-message-id').props.children).toBe(
          'msg-1',
        );
        expect(getByTestId('transcript-focus-request-id').props.children).toBe(
          '2',
        );
      });
    });

    it('does not wire onOpenMoment when the transcript tab is off', async () => {
      const services = require('@/services');
      (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
        mockSimulationDetailsTrigger,
        {
          data: {
            details: {summary: {}},
            score: 10,
            startedAt: '2024-01-01T00:00:00Z',
            endedAt: '2024-01-01T00:00:30Z',
            scenario: {
              title: 'Test',
              metadata: {
                feedbackTabs: {debrief: true, transcript: false},
              },
            },
            events: [],
          },
          isLoading: false,
        },
      ]);

      const {getByTestId, queryByTestId} = renderWithProviders(
        <SimulationFeedbackScreen
          navigation={{} as any}
          route={{params: {scenarioSessionId: '1'}} as any}
        />,
      );

      fireEvent.press(getByTestId('tab-0'));
      // No transcript tab exists to jump to, so the moment-open control is
      // never rendered.
      expect(queryByTestId('debrief-open-moment')).toBeNull();
    });
  });
});

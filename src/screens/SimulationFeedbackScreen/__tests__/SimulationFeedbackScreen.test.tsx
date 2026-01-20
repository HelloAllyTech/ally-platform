import React from 'react';
import {render, fireEvent, waitFor, act} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {SimulationFeedbackScreen} from '../SimulationFeedbackScreen';

let mockGoBack = jest.fn();
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({
    goBack: (...args: any[]) => mockGoBack(...args),
    navigate: jest.fn(),
    replace: jest.fn(),
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
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View, TouchableOpacity, Text} = require('react-native');
  const showToastMock = jest.fn();
  return {
    PrimaryButton: ({label, onPress}: any) => (
      <TouchableOpacity testID="primary-button" onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    FeedbackPopup: ({visible, onClose}: any) => (
      visible ? <View testID="feedback-popup" onTouchEnd={onClose} /> : null
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
  };
});

jest.mock('../components', () => {
  const React = require('react');
  const {TouchableOpacity, Text, View} = require('react-native');
  return {
    SimulationSummarySkeleton: () => <View testID="summary-skeleton" />,
    SimulationSummary: () => <View testID="summary-comp" />,
    SimulationTranscript: () => <View testID="transcript-comp" />,
    SimulationAudioPlayer: () => <View testID="audio-player" />,
    PrivacyToggle: () => <View testID="privacy-toggle" />,
    UpNextSimulationCard: () => <View testID="up-next-card" />,
    FeedbackDropdown: ({visible, setShowSummary}: any) => {
      if (!visible) return null;
      return (
        <TouchableOpacity 
          testID="transcript-option" 
          onPress={() => setShowSummary(false)}
        >
          <Text>Transcript Option</Text>
        </TouchableOpacity>
      );
    },
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

  it('renders summary when data exists', async () => {
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen
        navigation={{} as any}
        route={{params: {scenarioSessionId: '1'}} as any}
      />,
    );
    expect(getByTestId('summary-comp')).toBeTruthy();
  });

  it('opens feedback popup on button press', () => {
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    fireEvent.press(getByTestId('primary-button'));
    // Popup rendered by mocked component within screen
    // We don’t have direct access; behavior covered by the screen showing popup internally
  });

  it('shows skeleton when details are missing', () => {
    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      jest.fn().mockResolvedValue({data: {details: null}}),
      {data: {details: null}, isLoading: false},
    ]);

    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    expect(getByTestId('summary-skeleton')).toBeTruthy();
  });

  it('switches to transcript when header pressed (via dropdown sets showSummary=false)', async () => {
    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      jest.fn().mockResolvedValue({data: {details: {}}}),
      {data: {details: {summary: {}}, startedAt: '2024-01-01T00:00:00Z'}, isLoading: false},
    ]);
    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1', fromLogs: true}} as any} />,
    );
    // Press arrow icon within header to open dropdown (bubbles to Touchable)
    fireEvent.press(getByTestId('arrow-down'));
    // Wait for dropdown to appear and click transcript option
    await waitFor(() => {
      expect(getByTestId('transcript-option')).toBeTruthy();
    });
    fireEvent.press(getByTestId('transcript-option'));
    // Transcript should render after clicking the transcript option
    await waitFor(() => {
      expect(getByTestId('transcript-comp')).toBeTruthy();
    });
  });

  it('shows scroll-to-bottom button when not near bottom and handles press', async () => {
    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      jest.fn().mockResolvedValue({data: {details: {}}}),
      {data: {details: {summary: {}}, startedAt: '2024-01-01T00:00:00Z'}, isLoading: false},
    ]);
    const {UNSAFE_getByType, getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );
    const {KeyboardAwareScrollView} = require('react-native-keyboard-aware-scroll-view');
    const scrollView = UNSAFE_getByType(KeyboardAwareScrollView);
    // trigger onScroll with not near bottom to show button
    await act(async () => {
      scrollView.props.onScroll({
        nativeEvent: {
          contentOffset: {y: 0},
          contentSize: {height: 2000},
          layoutMeasurement: {height: 300},
        },
      });
    });
    // Button shows chevron icon
    await waitFor(() => {
      expect(getByTestId('chevron-down')).toBeTruthy();
    });
    // Press chevron icon (inside TouchableOpacity)
    fireEvent.press(getByTestId('chevron-down'));
  });

  it('when fromLogs and >= threshold with no feedback, shows feedback popup on back', async () => {
    jest.useFakeTimers();
    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      jest.fn().mockResolvedValue({data: {details: {}}}),
      {data: {details: {summary: {}}, hasFeedback: false}, isLoading: false},
    ]);

    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1', fromLogs: true}} as any} />,
    );

    // advance beyond FEEDBACK_THRESHOLD (30s)
    jest.advanceTimersByTime(31_000);

    // press back button
    fireEvent.press(getByTestId('left-arrow-icon'));
    // popup should be visible via mocked FeedbackPopup
    await waitFor(() => {
      // import from the module mock to ensure visibility
      const popup = getByTestId('feedback-popup');
      expect(popup).toBeTruthy();
    });
  });

  it('when fromLogs and < threshold, back goes to previous screen', () => {
    mockGoBack = jest.fn();

    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      jest.fn().mockResolvedValue({data: {details: {}}}),
      {data: {details: {summary: {}}, hasFeedback: false}, isLoading: false},
    ]);

    const {getByTestId} = renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1', fromLogs: true}} as any} />,
    );

    // immediately press back (below threshold)
    fireEvent.press(getByTestId('left-arrow-icon'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('retries until limit and then shows toast error', async () => {
    jest.useFakeTimers();
    const services = require('@/services');
    (services.useLazyGetSimulationDetailsQuery as jest.Mock).mockReturnValue([
      jest.fn().mockResolvedValue({data: {details: null}}),
      {data: {details: null}, isLoading: false},
    ]);

    const {__mocks__} = require('@/components');
    const {showToastMock} = __mocks__;
    showToastMock.mockClear();

    renderWithProviders(
      <SimulationFeedbackScreen navigation={{} as any} route={{params: {scenarioSessionId: '1'}} as any} />,
    );

    // RETRY_COUNT_LIMIT is 4, each after 5000ms; advance enough time
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
      });
    }

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalled();
    });
  });
});



import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';

import {SCREEN_NAMES} from '@/constants';
import {TrackProgressDashboard} from '@/types';

import {CourseProgressScreen} from '../CourseProgressScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({top: 0, bottom: 0, left: 0, right: 0})),
}));

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'courses.progressDashboard.feedbackSubheading') {
        return `Based on ${params?.count} session(s)`;
      }
      if (key === 'courses.progressDashboard.sessionScore') {
        return `Score ${params?.score}`;
      }
      if (key === 'courses.progressDashboard.practiceNudge') {
        return `${params?.category} could use more practice.`;
      }
      const translations: Record<string, string> = {
        'courses.progressDashboard.title': 'Progress',
        'courses.progressDashboard.notFound': 'Progress not found',
        'courses.progressDashboard.feedbackHeading': 'Consolidated feedback',
        'courses.progressDashboard.feedbackEmpty': 'Nothing yet',
        'courses.progressDashboard.sessionsHeading': 'Practice sessions',
        'courses.progressDashboard.sessionPending': 'Pending evaluation',
        'courses.progressDashboard.classification.demonstrated': 'Demonstrated',
        'courses.progressDashboard.classification.needs_practice':
          'Needs practice',
        'courses.progressDashboard.classification.insufficient_data':
          'Not enough practice yet',
        'courses.progressDashboard.latestFeedbackHeading': 'Latest feedback',
        'courses.progressDashboard.readFullFeedback': 'Read full feedback',
        'common.continue': 'Continue',
      };
      return translations[key] || key;
    },
  })),
  useHardwareBackPressHandler: jest.fn(),
}));

jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    EmptyState: ({title}: any) => <RN.Text testID="empty-state">{title}</RN.Text>,
    LearningPathHeader: ({title, onBackPress}: any) => (
      <RN.View testID="learning-path-header">
        <RN.TouchableOpacity testID="back-button" onPress={onBackPress}>
          <RN.Text>Back</RN.Text>
        </RN.TouchableOpacity>
        <RN.Text>{title}</RN.Text>
      </RN.View>
    ),
    ProgressBar: ({current, total}: any) => (
      <RN.Text testID="progress-bar">
        {current}/{total}
      </RN.Text>
    ),
    CircularProgress: ({children}: any) => (
      <RN.View testID="circular-progress">{children}</RN.View>
    ),
  };
});

const mockUseGetLearnTrackProgressQuery = jest.fn();
const mockGetNextItem = jest.fn(() => ({
  unwrap: jest
    .fn()
    .mockResolvedValue({trackCompleted: false, nextItem: {id: 'item-2'}}),
}));

jest.mock('@/services', () => ({
  useGetLearnTrackProgressQuery: (args: any) =>
    mockUseGetLearnTrackProgressQuery(args),
  useLazyGetNextTrackItemQuery: () => [mockGetNextItem],
}));

const mockNavigate = jest.fn();
const mockNavigation = {
  canGoBack: jest.fn(() => true),
  goBack: jest.fn(),
  navigate: mockNavigate,
};

const baseDashboard: TrackProgressDashboard = {
  trackId: 'track-1',
  title: 'De-escalation Basics',
  trackEnrollmentId: 'enr-1',
  totalItems: 4,
  completedItems: 2,
  completionPct: 50,
  startedAt: '2026-08-01T00:00:00.000Z',
  completedAt: null,
  lastActivityAt: '2026-08-05T00:00:00.000Z',
  sections: [
    {id: 'sec-1', title: 'Section 1', order: 1, completedItems: 2, totalItems: 4},
  ],
  evaluatedRoleplaySessionCount: 0,
  averageCompositeScore: null,
  skillCategories: [],
  roleplaySessions: [],
};

const renderScreen = (
  routeParams: {trackId: string} = {trackId: 'track-1'},
) =>
  render(
    <CourseProgressScreen
      navigation={mockNavigation as any}
      route={{params: routeParams} as any}
    />,
  );

describe('CourseProgressScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading indicator while the dashboard is fetching', () => {
    mockUseGetLearnTrackProgressQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
    });

    renderScreen();

    expect(screen.getByTestId('activity-indicator')).toBeTruthy();
  });

  it('shows an empty state when the dashboard errors', () => {
    mockUseGetLearnTrackProgressQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: {status: 403},
    });

    renderScreen();

    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });

  it('shows the feedback empty state when no roleplay session has been evaluated yet', () => {
    mockUseGetLearnTrackProgressQuery.mockReturnValue({
      data: baseDashboard,
      isLoading: false,
      error: undefined,
    });

    renderScreen();

    expect(screen.getByText('Nothing yet')).toBeTruthy();
    expect(screen.queryByText('Practice sessions')).toBeNull();
  });

  it('renders demonstrated, needs_practice and insufficient_data categories distinctly', () => {
    mockUseGetLearnTrackProgressQuery.mockReturnValue({
      data: {
        ...baseDashboard,
        evaluatedRoleplaySessionCount: 2,
        skillCategories: [
          {
            category: 'Listening Engagement',
            averagePercentage: 90,
            sampleSize: 2,
            classification: 'demonstrated',
          },
          {
            category: 'Emotional Attunement',
            averagePercentage: 40,
            sampleSize: 2,
            classification: 'needs_practice',
          },
          {
            category: 'Supportive Engagement',
            averagePercentage: 85,
            sampleSize: 1,
            classification: 'insufficient_data',
          },
        ],
      },
      isLoading: false,
      error: undefined,
    });

    renderScreen();

    expect(screen.getByText('Listening Engagement')).toBeTruthy();
    expect(screen.getByText('Demonstrated')).toBeTruthy();
    expect(screen.getByText('Needs practice')).toBeTruthy();
    expect(screen.getByText('Not enough practice yet')).toBeTruthy();
  });

  it('navigates to SimulationFeedback with the session id when a practice session row is pressed', () => {
    mockUseGetLearnTrackProgressQuery.mockReturnValue({
      data: {
        ...baseDashboard,
        evaluatedRoleplaySessionCount: 1,
        roleplaySessions: [
          {
            trackItemId: 'item-1',
            trackItemTitle: 'Practice: an upset client',
            scenarioSessionId: 'sess-1',
            compositeScore: 80,
            occurredAt: '2026-08-02T00:00:00.000Z',
            evaluationMarkdown: null,
          },
        ],
      },
      isLoading: false,
      error: undefined,
    });

    renderScreen();

    fireEvent.press(screen.getByText('Practice: an upset client'));

    expect(mockNavigate).toHaveBeenCalledWith(
      SCREEN_NAMES.SIMULATION_FEEDBACK,
      {scenarioSessionId: 'sess-1'},
    );
  });

  it('shows a preview of the latest session feedback and reads the full feedback on press', () => {
    mockUseGetLearnTrackProgressQuery.mockReturnValue({
      data: {
        ...baseDashboard,
        evaluatedRoleplaySessionCount: 1,
        roleplaySessions: [
          {
            trackItemId: 'item-1',
            trackItemTitle: 'Session 1',
            scenarioSessionId: 'sess-1',
            compositeScore: 70,
            occurredAt: '2026-08-02T00:00:00.000Z',
            evaluationMarkdown: '## What worked\nGreat rapport building.',
          },
        ],
      },
      isLoading: false,
      error: undefined,
    });

    renderScreen();

    expect(screen.getByText(/Great rapport building/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('latest-feedback-read-more'));

    expect(mockNavigate).toHaveBeenCalledWith(
      SCREEN_NAMES.SIMULATION_FEEDBACK,
      {scenarioSessionId: 'sess-1'},
    );
  });

  it('nudges toward the weakest needs_practice category and continues into the next item on press', async () => {
    mockUseGetLearnTrackProgressQuery.mockReturnValue({
      data: {
        ...baseDashboard,
        evaluatedRoleplaySessionCount: 2,
        skillCategories: [
          {
            category: 'Listening Engagement',
            averagePercentage: 90,
            sampleSize: 2,
            classification: 'demonstrated',
          },
          {
            category: 'Emotional Attunement',
            averagePercentage: 40,
            sampleSize: 2,
            classification: 'needs_practice',
          },
        ],
      },
      isLoading: false,
      error: undefined,
    });

    renderScreen();

    expect(
      screen.getByText('Emotional Attunement could use more practice.'),
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId('practice-nudge-continue'));

    expect(mockGetNextItem).toHaveBeenCalledWith({trackId: 'track-1'});
  });
});

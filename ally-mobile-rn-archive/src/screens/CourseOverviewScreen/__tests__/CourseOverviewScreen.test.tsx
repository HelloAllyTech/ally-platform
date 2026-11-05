import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {SCREEN_NAMES} from '@/constants';
import {TrackDetail, TrackItemStatus, TrackItemType} from '@/types';

import {CourseOverviewScreen} from '../CourseOverviewScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({top: 0, bottom: 0, left: 0, right: 0})),
}));

// The screen pulls in `getLabelFromCode` from LanguageSelectorSheet, which also
// imports the store — and `api.ts` <-> `store.ts` is circular, so entering the
// cycle from `api.ts` leaves `api` undefined while store.ts evaluates. Stub both
// so the real helper still runs. Same approach as LanguageSelectorSheet's own test.
jest.mock('@/services/api', () => ({
  api: {util: {resetApiState: () => ({type: 'api/resetApiState'})}},
}));

jest.mock('@/store/store', () => ({store: {dispatch: jest.fn()}}));

// The real @gorhom/bottom-sheet cannot render against the reanimated mock in
// jest.setup.ts (useAnimatedDetents needs live shared values), so stub the
// wrapper — the same boundary every other bottom-sheet suite here stubs.
jest.mock('@/components/BottomSheet', () => {
  const RN = require('react-native');
  return {
    BottomSheet: ({visible, children}: any) =>
      visible ? <RN.View testID="bottom-sheet">{children}</RN.View> : null,
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'courses.progress') {
        return `${params?.completed} of ${params?.total}`;
      }
      const translations: Record<string, string> = {
        'learn.choose.course': 'Course',
        'common.start': 'Start',
        'common.continue': 'Continue',
        'courses.notFound': 'Course not found',
        'courses.notAvailable.title':
          "This course isn't available for your account",
      };
      return translations[key] || key;
    },
    tVariable: (key: string) => key,
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
    LearningPathListHeader: ({
      title,
      isCompleted,
      startButtonLabel,
      onStartPress,
      isStartDisabled,
    }: any) => (
      <RN.View testID="learning-path-list-header">
        <RN.Text>{title}</RN.Text>
        {!isCompleted && (
          <RN.TouchableOpacity
            testID="start-button"
            onPress={onStartPress}
            disabled={isStartDisabled}>
            <RN.Text>{startButtonLabel}</RN.Text>
          </RN.TouchableOpacity>
        )}
      </RN.View>
    ),
    CircularProgress: ({children}: any) => (
      <RN.View testID="circular-progress">{children}</RN.View>
    ),
  };
});

const mockEnrollTrack = jest.fn(() => ({unwrap: jest.fn().mockResolvedValue({})}));
const mockGetNextItem = jest.fn(() => ({
  unwrap: jest.fn().mockResolvedValue({trackCompleted: false, nextItem: {id: 'item-2'}}),
}));
const mockSetTrackLanguage = jest.fn(() => ({
  unwrap: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/services', () => ({
  useGetLearnTrackDetailQuery: jest.fn(),
  useEnrollTrackMutation: jest.fn(() => [mockEnrollTrack, {isLoading: false}]),
  useLazyGetNextTrackItemQuery: jest.fn(() => [mockGetNextItem]),
  // Used by CourseLanguageSheet, which the screen always renders.
  useSetTrackLanguageMutation: jest.fn(() => [
    mockSetTrackLanguage,
    {isLoading: false},
  ]),
  // Used by CourseProgressSheet, which the screen always renders (mounted
  // closed; the query is skipped until it opens).
  useGetLearnTrackProgressQuery: jest.fn(() => ({
    data: undefined,
    isLoading: false,
    error: undefined,
  })),
}));

const {useGetLearnTrackDetailQuery} = require('@/services');

const mockNavigation = {
  canGoBack: jest.fn(() => true),
  goBack: jest.fn(),
  navigate: jest.fn(),
};

const buildTrack = (overrides: Partial<TrackDetail> = {}): TrackDetail => ({
  id: 'track-1',
  title: 'Test Course',
  description: 'A test course',
  coverImageUrl: null,
  status: 'ACTIVE',
  totalItems: 2,
  estimatedDurationMinutes: null,
  enrolled: true,
  trackEnrollmentId: 'enrollment-1',
  completedItems: 0,
  completedAt: null,
  sections: [
    {
      id: 'section-1',
      title: 'Section 1',
      description: null,
      order: 0,
      items: [
        {
          id: 'item-1',
          type: TrackItemType.ARTICLE,
          order: 0,
          title: 'Item 1',
          description: null,
          scenarioId: null,
          caseId: null,
          completionCriteria: null,
          contentMeta: null,
          status: TrackItemStatus.COMPLETED,
          startedAt: null,
          completedAt: '2026-01-01T00:00:00.000Z',
          score: null,
          attemptCount: null,
          maxWatchedPct: null,
        },
        {
          id: 'item-2',
          type: TrackItemType.QUIZ,
          order: 1,
          title: 'Item 2',
          description: null,
          scenarioId: null,
          caseId: null,
          completionCriteria: null,
          contentMeta: null,
          status: TrackItemStatus.UNLOCKED,
          startedAt: null,
          completedAt: null,
          score: null,
          attemptCount: null,
          maxWatchedPct: null,
        },
        {
          id: 'item-3',
          type: TrackItemType.VIDEO,
          order: 2,
          title: 'Item 3',
          description: null,
          scenarioId: null,
          caseId: null,
          completionCriteria: null,
          contentMeta: null,
          status: TrackItemStatus.LOCKED,
          startedAt: null,
          completedAt: null,
          score: null,
          attemptCount: null,
          maxWatchedPct: null,
        },
      ],
    },
  ],
  ...overrides,
});

const renderScreen = () =>
  render(
    <CourseOverviewScreen
      navigation={mockNavigation as any}
      route={{
        key: 'test',
        name: SCREEN_NAMES.COURSE_OVERVIEW,
        params: {trackId: 'track-1'},
      }}
    />,
  );

describe('CourseOverviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigation.canGoBack.mockReturnValue(true);
  });

  it('shows a loading indicator while the track detail is loading', () => {
    useGetLearnTrackDetailQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
      refetch: jest.fn(),
    });

    const {getByTestId} = renderScreen();
    expect(getByTestId('activity-indicator')).toBeTruthy();
  });

  it('shows the not-found empty state on error', () => {
    useGetLearnTrackDetailQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('failed'),
      refetch: jest.fn(),
    });

    const {getByTestId} = renderScreen();
    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('says the course is not available, not missing, on a 403', () => {
    // A shared course link opened by someone whose organisation or group the
    // course is not assigned to.
    useGetLearnTrackDetailQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: {status: 403, data: {message: 'Forbidden'}},
      refetch: jest.fn(),
    });

    const {getByTestId} = renderScreen();
    expect(getByTestId('empty-state').props.children).toBe(
      "This course isn't available for your account",
    );
  });

  it('keeps the not-found state for other errors', () => {
    useGetLearnTrackDetailQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: {status: 404, data: {message: 'Track not found'}},
      refetch: jest.fn(),
    });

    const {getByTestId} = renderScreen();
    expect(getByTestId('empty-state').props.children).toBe('Course not found');
  });

  it('renders section items with their titles once loaded', () => {
    useGetLearnTrackDetailQuery.mockReturnValue({
      data: buildTrack(),
      isLoading: false,
      error: undefined,
      refetch: jest.fn(),
    });

    const {getByText} = renderScreen();
    expect(getByText('Item 1')).toBeTruthy();
    expect(getByText('Item 2')).toBeTruthy();
    expect(getByText('Item 3')).toBeTruthy();
  });

  it('navigates to the item player when an unlocked item is pressed', () => {
    useGetLearnTrackDetailQuery.mockReturnValue({
      data: buildTrack(),
      isLoading: false,
      error: undefined,
      refetch: jest.fn(),
    });

    const {getByText} = renderScreen();
    fireEvent.press(getByText('Item 2'));

    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.COURSE_ITEM_PLAYER,
      {trackId: 'track-1', itemId: 'item-2'},
    );
  });

  it('does not navigate when a locked item is pressed', () => {
    useGetLearnTrackDetailQuery.mockReturnValue({
      data: buildTrack(),
      isLoading: false,
      error: undefined,
      refetch: jest.fn(),
    });

    const {getByText} = renderScreen();
    fireEvent.press(getByText('Item 3'));

    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it('enrolls and navigates to the next item when Start is pressed for an unenrolled course', async () => {
    useGetLearnTrackDetailQuery.mockReturnValue({
      data: buildTrack({enrolled: false}),
      isLoading: false,
      error: undefined,
      refetch: jest.fn(),
    });

    const {getByTestId} = renderScreen();
    fireEvent.press(getByTestId('start-button'));

    await waitFor(() =>
      expect(mockEnrollTrack).toHaveBeenCalledWith({trackId: 'track-1'}),
    );
  });

  it('calls navigation.goBack when the back button is pressed and back is available', () => {
    useGetLearnTrackDetailQuery.mockReturnValue({
      data: buildTrack(),
      isLoading: false,
      error: undefined,
      refetch: jest.fn(),
    });

    const {getByTestId} = renderScreen();
    fireEvent.press(getByTestId('back-button'));

    expect(mockNavigation.goBack).toHaveBeenCalled();
  });
});

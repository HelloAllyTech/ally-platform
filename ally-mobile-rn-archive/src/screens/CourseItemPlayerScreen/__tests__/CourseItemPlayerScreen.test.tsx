import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {SCREEN_NAMES} from '@/constants';
import {
  TrackDetail,
  TrackGameKey,
  TrackItemStatus,
  TrackItemType,
} from '@/types';

import {CourseItemPlayerScreen} from '../CourseItemPlayerScreen';

// The global jest.setup.ts mock for @/components forces every Button to
// testID="primary-button", which collapses the two distinct nav buttons
// this screen renders into one. Override it to preserve the real testID.
jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    Button: ({label, onPress, isDisabled, testID}: any) => (
      <RN.TouchableOpacity
        testID={testID}
        onPress={onPress}
        disabled={isDisabled}>
        <RN.Text>{label}</RN.Text>
      </RN.TouchableOpacity>
    ),
  };
});

// This test targets the player SHELL (nav gating, exit, celebration) — each
// real item player is unit-tested on its own (see components/players/
// __tests__/). Stand in a single mock covering all four with a "complete"
// affordance, matching what a real player does when it calls onCompleted.
jest.mock('../components/players/ArticlePlayer', () => {
  const RN = require('react-native');
  return {
    ArticlePlayer: ({onCompleted, itemId}: any) => (
      <RN.View testID="item-player-mock">
        <RN.Text>{itemId}</RN.Text>
        <RN.TouchableOpacity
          testID="mock-mark-complete"
          onPress={() =>
            onCompleted({
              completed: true,
              unlockedItemIds: [],
              sectionCompleted: false,
              // Fixture-specific: item-2 is the last item in every test's
              // track, so completing it always finishes the whole course.
              trackCompleted: itemId === 'item-2',
            })
          }>
          <RN.Text>Mark complete</RN.Text>
        </RN.TouchableOpacity>
      </RN.View>
    ),
  };
});
jest.mock('../components/players/VideoItemPlayer', () => ({
  VideoItemPlayer: () => null,
}));
jest.mock('../components/players/JournalPlayer', () => ({
  JournalPlayer: () => null,
}));
jest.mock('../components/players/GamePlayer', () => ({
  GamePlayer: () => null,
}));

jest.mock('../components/players/RoleplayCasePlayer', () => ({
  RoleplayCasePlayer: () => null,
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('@/hooks', () => {
  const actual = jest.requireActual('@/hooks/useTrackPlayerNavigation');
  return {
    useTrackPlayerNavigation: actual.useTrackPlayerNavigation,
    useTranslate: jest.fn(() => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'courses.player.overallProgress') {
          return `${params?.pct}% complete`;
        }
        return key;
      },
      tVariable: (key: string) => key,
    })),
  };
});

const mockStartTrackItem = jest.fn(() => ({
  unwrap: jest.fn().mockResolvedValue({
    type: TrackItemType.ARTICLE,
    trackItemProgressId: 'progress-1',
    html: '<p>Hello</p>',
    minReadSeconds: 1,
  }),
}));

jest.mock('@/services', () => ({
  useGetLearnTrackDetailQuery: jest.fn(),
  useStartTrackItemMutation: jest.fn(() => [mockStartTrackItem]),
}));

jest.mock('@/utils', () => ({
  navigateToLearnTab: jest.fn(),
  getActiveTrackContext: jest.fn().mockResolvedValue(null),
  clearActiveTrackContext: jest.fn().mockResolvedValue(undefined),
}));

const {useGetLearnTrackDetailQuery} = require('@/services');
const {navigateToLearnTab} = require('@/utils');

const mockNavigation = {
  canGoBack: jest.fn(() => true),
  goBack: jest.fn(),
  navigate: jest.fn(),
};

const buildItem = (
  overrides: Partial<TrackDetail['sections'][number]['items'][number]> & {
    id: string;
  },
) => ({
  type: TrackItemType.ARTICLE,
  order: 0,
  title: `Item ${overrides.id.split('-')[1] ?? overrides.id}`,
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
  ...overrides,
});

const buildTrack = (): TrackDetail => ({
  id: 'track-1',
  title: 'Course',
  description: null,
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
        buildItem({id: 'item-1', order: 0}),
        buildItem({id: 'item-2', order: 1}),
      ],
    },
  ],
});

const renderScreen = (itemId = 'item-1') =>
  render(
    <CourseItemPlayerScreen
      navigation={mockNavigation as any}
      route={{
        key: 'test',
        name: SCREEN_NAMES.COURSE_ITEM_PLAYER,
        params: {trackId: 'track-1', itemId},
      }}
    />,
  );

describe('CourseItemPlayerScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigation.canGoBack.mockReturnValue(true);
    mockStartTrackItem.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue({
        type: TrackItemType.ARTICLE,
        trackItemProgressId: 'progress-1',
        html: '<p>Hello</p>',
        minReadSeconds: 1,
      }),
    } as any);
    useGetLearnTrackDetailQuery.mockReturnValue({
      data: buildTrack(),
      refetch: jest.fn(),
    });
  });

  it('starts the current item and renders its player once loaded', async () => {
    const {getByTestId} = renderScreen('item-1');
    await waitFor(() => expect(getByTestId('item-player-mock')).toBeTruthy());
    expect(mockStartTrackItem).toHaveBeenCalledWith({itemId: 'item-1'});
  });

  it('disables Next until the item can advance, then enables it once marked complete', async () => {
    const {getByTestId, getByText} = renderScreen('item-1');
    await waitFor(() => expect(getByTestId('item-player-mock')).toBeTruthy());

    // Next is disabled pre-completion: pressing it does not advance.
    fireEvent.press(getByTestId('player-next-button'));
    expect(getByText('item-1')).toBeTruthy();

    fireEvent.press(getByTestId('mock-mark-complete'));
    await waitFor(() => expect(getByTestId('player-next-button')).toBeTruthy());

    fireEvent.press(getByTestId('player-next-button'));
    await waitFor(() => expect(getByText('item-2')).toBeTruthy());
  });

  it('disables Prev on the first item (pressing it does not move)', async () => {
    const {getByTestId, getByText} = renderScreen('item-1');
    await waitFor(() => expect(getByTestId('item-player-mock')).toBeTruthy());

    fireEvent.press(getByTestId('player-prev-button'));
    expect(getByText('item-1')).toBeTruthy();
  });

  it('enables Prev on a later item', async () => {
    const {getByTestId, getByText} = renderScreen('item-2');
    await waitFor(() => expect(getByTestId('item-player-mock')).toBeTruthy());

    fireEvent.press(getByTestId('player-prev-button'));
    await waitFor(() => expect(getByText('item-1')).toBeTruthy());
  });

  it('shows "Finish" as the Next label on the last item', async () => {
    const {getByText} = renderScreen('item-2');
    await waitFor(() => expect(getByText('courses.player.finish')).toBeTruthy());
  });

  it('exits to the overview via goBack when the exit button is pressed', async () => {
    const {getByTestId} = renderScreen('item-1');
    await waitFor(() => expect(getByTestId('item-player-mock')).toBeTruthy());
    fireEvent.press(getByTestId('player-exit-button'));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });

  it('navigates to the overview screen directly when there is nothing to go back to', async () => {
    mockNavigation.canGoBack.mockReturnValue(false);
    const {getByTestId} = renderScreen('item-1');
    await waitFor(() => expect(getByTestId('item-player-mock')).toBeTruthy());
    fireEvent.press(getByTestId('player-exit-button'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      SCREEN_NAMES.COURSE_OVERVIEW,
      {trackId: 'track-1'},
    );
  });

  it('shows the unsupported-component card for a type this build cannot play', async () => {
    // A course authored on the web can carry a component type older app
    // binaries have no player for. Before the fallback this rendered nothing:
    // an empty body under a live top bar, with no explanation.
    mockStartTrackItem.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue({
        type: 'SOME_FUTURE_TYPE',
        trackItemProgressId: 'progress-1',
      }),
    } as any);

    const {getByTestId} = renderScreen('item-1');
    await waitFor(() =>
      expect(getByTestId('unsupported-item-card')).toBeTruthy(),
    );
  });

  it('shows the unsupported card for a breathing exercise that arrives without its configuration', async () => {
    // The server sends the exercise's timings with the payload. Without them
    // there is nothing to run, and this used to leave the body empty.
    mockStartTrackItem.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue({
        type: TrackItemType.GAME,
        gameKey: TrackGameKey.BREATHING_EXERCISE,
        intro: null,
        bestScore: null,
        playCount: 0,
        trackItemProgressId: 'progress-1',
        completion: {completed: true},
      }),
    } as any);

    const {getByTestId} = renderScreen('item-1');
    await waitFor(() =>
      expect(getByTestId('unsupported-item-card')).toBeTruthy(),
    );
  });

  it('shows the track-completion celebration and routes back to Learn from it', async () => {
    // item-2 is the last item, so completing it with no next item is a track completion.
    const {getByTestId, queryByTestId} = renderScreen('item-2');
    await waitFor(() => expect(getByTestId('item-player-mock')).toBeTruthy());

    fireEvent.press(getByTestId('mock-mark-complete'));

    await waitFor(() => expect(getByTestId('celebration-cta')).toBeTruthy());
    fireEvent.press(getByTestId('celebration-cta'));

    expect(navigateToLearnTab).toHaveBeenCalledWith(mockNavigation);
    await waitFor(() => expect(queryByTestId('celebration-cta')).toBeNull());
  });
});

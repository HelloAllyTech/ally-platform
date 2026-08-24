import React from 'react';
import {act, render, waitFor} from '@testing-library/react-native';

import {TrackGameKey, TrackItemType} from '@/types';

import {GamePlayer} from '../GamePlayer';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    tVariable: (key: string) => key,
  })),
}));

const mockRecordGameResult = jest.fn(() => ({
  unwrap: jest.fn().mockResolvedValue({bestScore: 0, playCount: 1, score: 0}),
}));

jest.mock('@/services', () => ({
  useRecordGameResultMutation: jest.fn(() => [mockRecordGameResult]),
}));

jest.mock('react-native-webview', () => {
  const RN = require('react-native');
  const MockWebView = (props: any) => <RN.View testID="webview" {...props} />;
  return {__esModule: true, default: MockWebView};
});

const completion = {
  completed: true,
  unlockedItemIds: ['next-item'],
  sectionCompleted: false,
  trackCompleted: false,
};

const buildPayload = (overrides = {}) => ({
  type: TrackItemType.GAME as const,
  trackItemProgressId: 'progress-1',
  gameKey: TrackGameKey.TREX_RUNNER,
  intro: 'Shake that call off.',
  bestScore: null,
  playCount: 0,
  completion,
  ...overrides,
});

/** Drive the bundle -> app bridge the way the WebView would. */
const postFromGame = (getByTestId: any, payload: unknown) =>
  act(() => {
    getByTestId('webview').props.onMessage({
      nativeEvent: {data: JSON.stringify(payload)},
    });
  });

describe('GamePlayer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports completion on mount so Next is live before the learner plays', async () => {
    const onCompleted = jest.fn();
    render(
      <GamePlayer
        payload={buildPayload()}
        itemId="item-1"
        onCompleted={onCompleted}
      />,
    );
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(completion));
  });

  it('renders the author intro when there is one', () => {
    const {getByText} = render(
      <GamePlayer
        payload={buildPayload()}
        itemId="item-1"
        onCompleted={jest.fn()}
      />,
    );
    expect(getByText('Shake that call off.')).toBeTruthy();
  });

  it('records a finished run and shows it as the new personal best', async () => {
    const {getByTestId, getByText} = render(
      <GamePlayer
        payload={buildPayload()}
        itemId="item-1"
        onCompleted={jest.fn()}
      />,
    );

    postFromGame(getByTestId, {source: 'ally-game', type: 'over', score: 140});

    await waitFor(() =>
      expect(mockRecordGameResult).toHaveBeenCalledWith({
        itemId: 'item-1',
        score: 140,
      }),
    );
    expect(getByText('courses.game.bestScore.TREX_RUNNER:{"score":140}')).toBeTruthy();
  });

  it('keeps the better score when a later run is worse', async () => {
    const {getByTestId, getByText} = render(
      <GamePlayer
        payload={buildPayload({bestScore: 300})}
        itemId="item-1"
        onCompleted={jest.fn()}
      />,
    );

    postFromGame(getByTestId, {source: 'ally-game', type: 'over', score: 90});

    await waitFor(() =>
      expect(getByText('courses.game.lastScore.TREX_RUNNER:{"score":90}')).toBeTruthy(),
    );
    expect(getByText('courses.game.bestScore.TREX_RUNNER:{"score":300}')).toBeTruthy();
  });

  it('ignores messages that are not from a game bundle', () => {
    const {getByTestId} = render(
      <GamePlayer
        payload={buildPayload()}
        itemId="item-1"
        onCompleted={jest.fn()}
      />,
    );

    postFromGame(getByTestId, {source: 'something-else', type: 'over', score: 9});
    act(() => {
      getByTestId('webview').props.onMessage({nativeEvent: {data: 'not json'}});
    });

    expect(mockRecordGameResult).not.toHaveBeenCalled();
  });

  it('survives a failed score post — a lost personal best is a non-event', async () => {
    mockRecordGameResult.mockReturnValueOnce({
      unwrap: jest.fn().mockRejectedValue(new Error('offline')),
    } as never);
    const {getByTestId, getByText} = render(
      <GamePlayer
        payload={buildPayload()}
        itemId="item-1"
        onCompleted={jest.fn()}
      />,
    );

    postFromGame(getByTestId, {source: 'ally-game', type: 'over', score: 55});

    // Still shown locally even though the server never heard about it.
    await waitFor(() =>
      expect(getByText('courses.game.bestScore.TREX_RUNNER:{"score":55}')).toBeTruthy(),
    );
  });

  it('injects the SNAKE frame strings so the bundle draws in the learner language', () => {
    const {getByTestId} = render(
      <GamePlayer
        payload={buildPayload({gameKey: TrackGameKey.SNAKE})}
        itemId="item-1"
        onCompleted={jest.fn()}
      />,
    );

    const injected = getByTestId('webview').props
      .injectedJavaScriptBeforeContentLoaded as string;
    expect(injected).toContain('courses.game.frameStrings.SNAKE.score');
    expect(injected).toContain('courses.game.frameStrings.SNAKE.best');
    expect(injected).toContain('courses.game.frameStrings.SNAKE.restart');
    expect(injected).toContain('courses.game.frameStrings.SNAKE.gameOver');
  });

  it('shows a friendly message instead of a blank screen for a gameKey this build does not know', () => {
    const unknownGameKey = 'FUTURE_GAME' as TrackGameKey;
    const {getByText, queryByTestId} = render(
      <GamePlayer
        payload={buildPayload({gameKey: unknownGameKey})}
        itemId="item-1"
        onCompleted={jest.fn()}
      />,
    );

    expect(getByText('courses.player.unsupportedTitle')).toBeTruthy();
    expect(getByText('courses.player.unsupportedBody')).toBeTruthy();
    expect(queryByTestId('webview')).toBeNull();
  });
});

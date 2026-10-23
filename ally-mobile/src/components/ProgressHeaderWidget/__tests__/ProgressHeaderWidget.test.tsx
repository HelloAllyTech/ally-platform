import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SCREEN_NAMES} from '@/constants';

const mockNavigate = jest.fn();
const mockState = {
  summary: undefined as any,
  canViewProgress: true,
  routeName: 'Learn',
};

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({name: mockState.routeName}),
}));

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({navigate: mockNavigate}),
  useProgressSummary: () => ({
    summary: mockState.summary,
    canViewProgress: mockState.canViewProgress,
  }),
}));

import {ProgressHeaderWidget} from '../ProgressHeaderWidget';

const SUMMARY = {
  level: 5,
  totalXp: 1000,
  xpIntoLevel: 74,
  xpToNextLevel: 655,
  nextLevelXp: 1581,
  progress: 0.1,
  isMaxLevel: false,
};

describe('ProgressHeaderWidget', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockState.summary = SUMMARY;
    mockState.canViewProgress = true;
    mockState.routeName = 'Learn';
  });

  it('shows the level ring on an ordinary screen', () => {
    const {getByTestId} = render(<ProgressHeaderWidget />);

    expect(getByTestId('level-indicator')).toBeTruthy();
  });

  it('opens the Progress screen in one tap', () => {
    const {getByTestId} = render(<ProgressHeaderWidget />);

    fireEvent.press(getByTestId('level-indicator'));

    expect(mockNavigate).toHaveBeenCalledWith(SCREEN_NAMES.PROGRESS);
  });

  it('renders nothing for an org without the feature', () => {
    mockState.canViewProgress = false;

    const {queryByTestId} = render(<ProgressHeaderWidget />);

    expect(queryByTestId('level-indicator')).toBeNull();
  });

  it('renders nothing before the summary has arrived, rather than a placeholder ring', () => {
    mockState.summary = undefined;

    const {queryByTestId} = render(<ProgressHeaderWidget />);

    expect(queryByTestId('level-indicator')).toBeNull();
  });

  it('hides itself on the Progress screen, which already shows the same ring', () => {
    mockState.routeName = SCREEN_NAMES.PROGRESS;

    const {queryByTestId} = render(<ProgressHeaderWidget />);

    expect(queryByTestId('level-indicator')).toBeNull();
  });
});

import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {SCREEN_NAMES} from '@/constants';
import {TrackItemType} from '@/types';

import {RoleplayCasePlayer} from '../RoleplayCasePlayer';

const mockNavigate = jest.fn();
const mockStartSimulation = jest.fn().mockResolvedValue(undefined);
const mockSetActiveTrackContext = jest.fn().mockResolvedValue(undefined);

jest.mock('@/hooks', () => ({
  useAppNavigation: jest.fn(() => ({navigate: mockNavigate})),
  useStartSimulation: jest.fn(() => ({
    startSimulation: mockStartSimulation,
    isCreatingRoom: false,
  })),
  useTranslate: jest.fn(() => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    tVariable: (key: string) => key,
  })),
}));

jest.mock('@/utils', () => ({
  formatDate: (d: string) => `formatted(${d})`,
  getTriggerWarningNames: (tw?: {name: string}[]) => tw?.map(t => t.name) ?? [],
  setActiveTrackContext: (ctx: unknown) => mockSetActiveTrackContext(ctx),
}));

jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    Button: ({label, onPress, isLoading, testID}: any) => (
      <RN.TouchableOpacity testID={testID} onPress={onPress} disabled={isLoading}>
        <RN.Text>{label}</RN.Text>
      </RN.TouchableOpacity>
    ),
    SimulationCard: ({title, onPress}: any) => (
      <RN.TouchableOpacity testID="simulation-card" onPress={onPress}>
        <RN.Text>{title}</RN.Text>
      </RN.TouchableOpacity>
    ),
  };
});

jest.mock('@/services', () => ({
  useGetScenarioByIdQuery: jest.fn(() => ({data: {coverImageUrl: 'cover.jpg', description: 'desc', triggerWarnings: []}})),
  useGetCaseDetailsQuery: jest.fn(() => ({data: undefined})),
}));

const buildItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  type: TrackItemType.ROLEPLAY,
  order: 0,
  title: 'Practice a difficult conversation',
  description: null,
  scenarioId: 42,
  caseId: null,
  completionCriteria: null,
  contentMeta: null,
  status: 'UNLOCKED',
  startedAt: null,
  completedAt: null,
  score: null,
  attemptCount: null,
  maxWatchedPct: null,
  ...overrides,
});

const roleplayPayload = () => ({
  type: TrackItemType.ROLEPLAY as const,
  trackItemProgressId: 'progress-1',
  scenarioId: 42,
  completionCriteria: null,
  lastScenarioSessionId: null,
});

const casePayload = () => ({
  type: TrackItemType.CASE as const,
  trackItemProgressId: 'progress-1',
  caseId: 'case-1',
  caseSessionId: 'session-1',
  caseCompleted: false,
});

describe('RoleplayCasePlayer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('launching a roleplay stashes the active-track context and starts the simulation', async () => {
    const {getByTestId} = render(
      <RoleplayCasePlayer
        payload={roleplayPayload()}
        item={buildItem() as any}
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );

    fireEvent.press(getByTestId('roleplay-case-launch'));

    await waitFor(() =>
      expect(mockSetActiveTrackContext).toHaveBeenCalledWith({
        trackId: 'track-1',
        itemId: 'item-1',
      }),
    );
    await waitFor(() =>
      expect(mockStartSimulation).toHaveBeenCalledWith({
        scenarioId: 42,
        trackItemProgressId: 'progress-1',
      }),
    );
  });

  it('launching a case stashes the context and navigates to the case details screen', async () => {
    const {getByTestId} = render(
      <RoleplayCasePlayer
        payload={casePayload()}
        item={buildItem({type: TrackItemType.CASE, caseId: 'case-1'}) as any}
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );

    fireEvent.press(getByTestId('roleplay-case-launch'));

    await waitFor(() => expect(mockSetActiveTrackContext).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(SCREEN_NAMES.CASE_DETAILS, {
        caseId: 'case-1',
      }),
    );
    expect(mockStartSimulation).not.toHaveBeenCalled();
  });

  it('shows a "completed on" chip and a Replay label for a completed roleplay', () => {
    const {getByText} = render(
      <RoleplayCasePlayer
        payload={roleplayPayload()}
        item={buildItem({completedAt: '2026-01-01T00:00:00.000Z'}) as any}
        trackId="track-1"
        alreadyCompleted
      />,
    );

    expect(getByText('courses.roleplay.replay')).toBeTruthy();
    expect(
      getByText(/courses.roleplay.completedOn/),
    ).toBeTruthy();
  });

  it('shows "Open case" for a case item, never "Replay"', () => {
    const {getByText, queryByText} = render(
      <RoleplayCasePlayer
        payload={casePayload()}
        item={buildItem({type: TrackItemType.CASE, caseId: 'case-1', completedAt: '2026-01-01T00:00:00.000Z'}) as any}
        trackId="track-1"
        alreadyCompleted
      />,
    );

    expect(getByText('courses.roleplay.openCase')).toBeTruthy();
    expect(queryByText('courses.roleplay.replay')).toBeNull();
  });
});

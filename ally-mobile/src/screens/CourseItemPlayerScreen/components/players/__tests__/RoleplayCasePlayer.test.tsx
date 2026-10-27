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
    CustomDropdown: ({value, options, onSelect}: any) => (
      <RN.View testID="language-dropdown">
        <RN.Text testID="language-dropdown-value">{value}</RN.Text>
        {options.map((option: string) => (
          <RN.TouchableOpacity
            key={option}
            testID={`language-option-${option}`}
            onPress={() => onSelect(option)}>
            <RN.Text>{option}</RN.Text>
          </RN.TouchableOpacity>
        ))}
      </RN.View>
    ),
  };
});

const mockUseGetScenarioByIdQuery = jest.fn();

jest.mock('@/services', () => ({
  useGetScenarioByIdQuery: (...args: unknown[]) =>
    mockUseGetScenarioByIdQuery(...args),
  useGetCaseDetailsQuery: jest.fn(() => ({data: undefined})),
}));

const scenarioDetail = (overrides: Record<string, unknown> = {}) => ({
  coverImageUrl: 'cover.jpg',
  description: 'desc',
  triggerWarnings: [],
  ...overrides,
});

const languages = [
  {language_id: 1, label: 'English', value: 'en', active: true},
  {language_id: 2, label: 'Hindi', value: 'hi', active: true},
];

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGetScenarioByIdQuery.mockReturnValue({data: scenarioDetail()});
  });

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

  it('shows no language picker when the scenario offers no languages', () => {
    const {queryByTestId} = render(
      <RoleplayCasePlayer
        payload={roleplayPayload()}
        item={buildItem() as any}
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );

    expect(queryByTestId('language-dropdown')).toBeNull();
  });

  it('offers the scenario languages, defaults to the first, and starts in the picked one', async () => {
    mockUseGetScenarioByIdQuery.mockReturnValue({
      data: scenarioDetail({availableLanguages: languages}),
    });

    const {getByTestId} = render(
      <RoleplayCasePlayer
        payload={roleplayPayload()}
        item={buildItem() as any}
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );

    await waitFor(() =>
      expect(getByTestId('language-dropdown-value').props.children).toBe(
        'English',
      ),
    );

    fireEvent.press(getByTestId('language-option-Hindi'));
    expect(getByTestId('language-dropdown-value').props.children).toBe(
      'Hindi',
    );

    fireEvent.press(getByTestId('roleplay-case-launch'));

    await waitFor(() =>
      expect(mockStartSimulation).toHaveBeenCalledWith({
        scenarioId: 42,
        trackItemProgressId: 'progress-1',
        languageId: 2,
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

describe('RoleplayCasePlayer — assessment mode', () => {
  const assessmentPayload = (submittedAt: string | null) => ({
    ...roleplayPayload(),
    completionCriteria: {assessmentMode: true},
    assessmentSubmittedAt: submittedAt,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGetScenarioByIdQuery.mockReturnValue({
      data: scenarioDetail({availableLanguages: languages}),
    });
  });

  it('warns about the single attempt and still lets the learner start', async () => {
    const {getByTestId} = render(
      <RoleplayCasePlayer
        payload={assessmentPayload(null)}
        item={buildItem() as any}
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );

    expect(getByTestId('roleplay-assessment-notice')).toBeTruthy();
    fireEvent.press(getByTestId('roleplay-case-launch'));
    await waitFor(() => expect(mockStartSimulation).toHaveBeenCalled());
  });

  it('locks a submitted attempt: no launch from the button or the card', () => {
    const {getByTestId, queryByTestId} = render(
      <RoleplayCasePlayer
        payload={assessmentPayload('2026-10-26T09:00:00.000Z')}
        item={buildItem() as any}
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );

    expect(getByTestId('roleplay-assessment-locked')).toBeTruthy();
    expect(getByTestId('roleplay-assessment-submitted')).toBeTruthy();
    expect(queryByTestId('roleplay-case-launch')).toBeNull();
    expect(queryByTestId('language-dropdown')).toBeNull();

    fireEvent.press(getByTestId('simulation-card'));
    expect(mockSetActiveTrackContext).not.toHaveBeenCalled();
    expect(mockStartSimulation).not.toHaveBeenCalled();
  });

  it('shows a passed assessment as completed, with no replay', () => {
    const {getByTestId, queryByTestId} = render(
      <RoleplayCasePlayer
        payload={assessmentPayload('2026-10-26T09:00:00.000Z')}
        item={buildItem({completedAt: '2026-10-26T09:00:00.000Z'}) as any}
        trackId="track-1"
        alreadyCompleted
      />,
    );

    expect(getByTestId('roleplay-assessment-locked')).toBeTruthy();
    expect(queryByTestId('roleplay-assessment-submitted')).toBeNull();
    expect(queryByTestId('roleplay-case-launch')).toBeNull();
  });
});

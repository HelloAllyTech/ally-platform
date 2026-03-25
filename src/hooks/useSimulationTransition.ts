import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {SimulationEventStatus} from '@/constants';
import {
  useGetAvailableLanguagesQuery,
  useGetUpcomingCaseScenarioQuery,
  useGetUpcomingScenarioQuery,
  useGetUserPreferencesQuery,
} from '@/services';
import {CurrentSessionInfo, SessionItemStatus, UpNextSimulation} from '@/types';

import {useStartSimulation} from './useStartSimulation';

const RETRY_COUNT_LIMIT = 4;
const RETRY_DELAY = 5000;

export interface UseSimulationTransitionParams {
  scenarioSessionId?: string;
  pathId?: string;
  caseId?: string;
  languageId?: number;
  enabled?: boolean;
}

interface UseSimulationTransitionReturn {
  currentSession?: CurrentSessionInfo;
  upcomingScenario?: UpNextSimulation;
  isEventCompleted: boolean;
  isFlowCompleted: boolean;
  hasUpcoming: boolean;
  canRetryCurrentSession: boolean;
  isCurrentSessionCompleted: boolean;
  isLoading: boolean;
  // Actions
  retrySimulation: () => void;
  startNextSimulation: () => void;
  isStartingSimulation: boolean;
  // 429 retry modal
  showRetryModal: boolean;
  retryStartSimulation: () => Promise<boolean>;
  closeRetryModal: () => void;
}

/**
 * Custom hook to manage simulation transition state and actions for both path and case flows.
 * Handles polling for upcoming scenarios, provides computed state flags, and transition actions.
 * Automatically determines the flow type based on whether pathId or caseId is provided.
 *
 * @param params - Hook parameters
 * @param params.scenarioSessionId - The current scenario session ID
 * @param params.pathId - The path ID (provide for path flow)
 * @param params.caseId - The case ID (provide for case flow)
 * @param params.enabled - Whether to enable the hook (default: true)
 *
 * @returns Object containing:
 * - currentSession: Current session information
 * - upcomingScenario: Next scenario in the flow
 * - isEventCompleted: Whether the current simulation event is completed
 * - isFlowCompleted: Whether the entire path/case flow is completed
 * - hasUpcoming: Whether there's an upcoming scenario
 * - canRetryCurrentSession: Whether the current session can be retried
 * - isCurrentSessionCompleted: Whether the current session item is completed
 * - isLoading: Loading state
 * - retrySimulation: Function to retry the current simulation
 * - startNextSimulation: Function to start the next simulation in the flow
 * - isStartingSimulation: Whether a simulation is currently being started
 */
export const useSimulationTransition = ({
  scenarioSessionId,
  pathId,
  caseId,
  languageId,
  enabled = true,
}: UseSimulationTransitionParams): UseSimulationTransitionReturn => {
  const [pollingInterval, setPollingInterval] = useState<number>(RETRY_DELAY);
  const nextSimulationPollingAttemptsRef = useRef<number>(0);

  const {
    startSimulation,
    isCreatingRoom: isStartingSimulation,
    showRetryModal,
    retryStartSimulation,
    closeRetryModal,
  } = useStartSimulation();

  // Resolve languageId: use explicit param, fall back to user preference, then first available
  const {data: preferencesData} = useGetUserPreferencesQuery();
  const {data: languagesData} = useGetAvailableLanguagesQuery({
    active: true,
    hasVoices: true,
  });

  const resolvedLanguageId = useMemo(() => {
    if (languageId) {
      return languageId;
    }
    const preferredId = preferencesData?.data?.default_language_id;
    if (
      preferredId &&
      languagesData?.some(lang => lang.language_id === preferredId)
    ) {
      return preferredId;
    }
    return languagesData?.[0]?.language_id;
  }, [languageId, preferencesData, languagesData]);

  // Automatically determine flow type based on which ID is provided
  const isCase = !!caseId;

  // Use path API (only when pathId is provided)
  const {
    data: pathUpcomingData,
    fulfilledTimeStamp: pathFulfilledTimeStamp,
    isLoading: isPathLoading,
  } = useGetUpcomingScenarioQuery(
    {scenarioSessionId: scenarioSessionId || ''},
    {
      skip: !enabled || !scenarioSessionId || !pathId || isCase,
      pollingInterval,
    },
  );

  // Use case API (only when caseId is provided)
  const {
    data: caseUpcomingData,
    fulfilledTimeStamp: caseFulfilledTimeStamp,
    isLoading: isCaseLoading,
  } = useGetUpcomingCaseScenarioQuery(
    {scenarioSessionId: scenarioSessionId || ''},
    {
      skip: !enabled || !scenarioSessionId || !caseId || !isCase,
      pollingInterval,
    },
  );

  // Select the appropriate data based on which ID was provided
  const upcomingData = isCase ? caseUpcomingData : pathUpcomingData;
  const fulfilledTimeStamp = isCase
    ? caseFulfilledTimeStamp
    : pathFulfilledTimeStamp;
  const isLoading = isCase ? isCaseLoading : isPathLoading;

  useEffect(() => {
    if (
      upcomingData?.currentSession?.eventStatus ===
        SimulationEventStatus.COMPLETED ||
      nextSimulationPollingAttemptsRef.current >= RETRY_COUNT_LIMIT
    ) {
      setPollingInterval(0);
    } else {
      nextSimulationPollingAttemptsRef.current += 1;
    }
  }, [upcomingData, fulfilledTimeStamp]);

  useEffect(() => {
    if (enabled) {
      setPollingInterval(RETRY_DELAY);
      nextSimulationPollingAttemptsRef.current = 0;
    }
  }, [scenarioSessionId, enabled]);

  const upcomingScenario = upcomingData?.upcomingScenario;
  const currentSession = upcomingData?.currentSession;
  const hasUpcoming = !!upcomingScenario;

  // Support both path and case fields - automatically select based on flow type
  const sessionItemStatus = isCase
    ? currentSession?.caseSessionItemStatus
    : currentSession?.scenarioPathSessionItemStatus;
  const sessionItemId = isCase
    ? currentSession?.caseSessionItemId
    : currentSession?.scenarioPathSessionItemId;
  const isFlowCompleted = isCase
    ? !!currentSession?.isCaseSessionCompleted
    : !!currentSession?.isScenarioPathSessionCompleted;

  const isCurrentSessionCompleted =
    sessionItemStatus === SessionItemStatus.COMPLETED;
  const canRetryCurrentSession = !!sessionItemId && !isCurrentSessionCompleted;
  const isEventCompleted =
    currentSession?.eventStatus === SimulationEventStatus.COMPLETED;

  /**
   * Retry the current simulation session
   * Automatically handles both path and case flows
   */
  const retrySimulation = useCallback(() => {
    if (!currentSession || !currentSession.scenarioId) {
      return;
    }

    // Check for either path or case session item ID
    const hasPathSessionItem = !!currentSession.scenarioPathSessionItemId;
    const hasCaseSessionItem = !!currentSession.caseSessionItemId;

    if (!hasPathSessionItem && !hasCaseSessionItem) {
      return;
    }

    startSimulation({
      scenarioId: currentSession.scenarioId,
      ...(hasPathSessionItem && {
        scenarioPathSessionItemId: currentSession.scenarioPathSessionItemId,
      }),
      ...(hasCaseSessionItem && {
        caseSessionItemId: currentSession.caseSessionItemId,
      }),
      pathId,
      caseId,
      ...(resolvedLanguageId && {languageId: resolvedLanguageId}),
    });
  }, [currentSession, pathId, caseId, resolvedLanguageId, startSimulation]);

  /**
   * Start the next simulation in the flow
   * Automatically handles both path and case flows
   */
  const startNextSimulation = useCallback(() => {
    if (!upcomingScenario || !upcomingScenario.id) {
      return;
    }

    // Check for either path or case session item ID
    const hasPathSessionItem = !!upcomingScenario.scenarioPathSessionItemId;
    const hasCaseSessionItem = !!upcomingScenario.caseSessionItemId;

    if (!hasPathSessionItem && !hasCaseSessionItem) {
      return;
    }

    startSimulation({
      scenarioId: upcomingScenario.id,
      ...(hasPathSessionItem && {
        scenarioPathSessionItemId: upcomingScenario.scenarioPathSessionItemId,
      }),
      ...(hasCaseSessionItem && {
        caseSessionItemId: upcomingScenario.caseSessionItemId,
      }),
      pathId,
      caseId,
      ...(resolvedLanguageId && {languageId: resolvedLanguageId}),
    });
  }, [upcomingScenario, pathId, caseId, resolvedLanguageId, startSimulation]);

  return {
    currentSession,
    upcomingScenario,
    isEventCompleted,
    isFlowCompleted,
    hasUpcoming,
    canRetryCurrentSession,
    isCurrentSessionCompleted,
    isLoading,
    retrySimulation,
    startNextSimulation,
    isStartingSimulation,
    showRetryModal,
    retryStartSimulation,
    closeRetryModal,
  };
};

import {useEffect, useRef, useState} from 'react';

import {SimulationEventStatus} from '@/constants';
import {
  useGetUpcomingCaseScenarioQuery,
  useGetUpcomingScenarioQuery,
} from '@/services';
import {CurrentSessionInfo, SessionItemStatus, UpNextSimulation} from '@/types';

const RETRY_COUNT_LIMIT = 4;
const RETRY_DELAY = 5000;

export interface UseSimulationTransitionParams {
  scenarioSessionId?: string;
  pathId?: string;
  caseId?: string;
  enabled?: boolean;
}

interface UseSimulationTransitionReturn {
  currentSession?: CurrentSessionInfo;
  upcomingScenario?: UpNextSimulation;
  isEventCompleted: boolean;
  isPathCompleted: boolean;
  hasUpcoming: boolean;
  canRetryCurrent: boolean;
  isCurrentSessionCompleted: boolean;
  isLoading: boolean;
}

/**
 * Custom hook to manage simulation transition state for both path and case flows.
 * Handles polling for upcoming scenarios and provides computed state flags.
 * Automatically determines the flow type based on whether pathId or caseId is provided.
 *
 * @param params - Hook parameters
 * @param params.scenarioSessionId - The current scenario session ID
 * @param params.pathId - The path ID (provide for path flow)
 * @param params.caseId - The case ID (provide for case flow)
 * @param params.enabled - Whether to enable the hook (default: true)
 *
 * @returns Object containing current session, upcoming scenario, and computed state flags
 *
 */
export const useSimulationTransition = ({
  scenarioSessionId,
  pathId,
  caseId,
  enabled = true,
}: UseSimulationTransitionParams): UseSimulationTransitionReturn => {
  const [pollingInterval, setPollingInterval] = useState<number>(RETRY_DELAY);
  const nextSimulationPollingAttemptsRef = useRef<number>(0);

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
  const isCurrentSessionCompleted =
    currentSession?.scenarioPathSessionItemStatus ===
    SessionItemStatus.COMPLETED;
  const canRetryCurrent =
    !!currentSession?.scenarioPathSessionItemId && !isCurrentSessionCompleted;
  const isPathCompleted = !!currentSession?.isScenarioPathSessionCompleted;
  const isEventCompleted =
    currentSession?.eventStatus === SimulationEventStatus.COMPLETED;

  return {
    currentSession,
    upcomingScenario,
    isEventCompleted,
    isPathCompleted,
    hasUpcoming,
    canRetryCurrent,
    isCurrentSessionCompleted,
    isLoading,
  };
};

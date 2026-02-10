import {useCallback, useState} from 'react';
import {SerializedError} from '@reduxjs/toolkit';
import {FetchBaseQueryError} from '@reduxjs/toolkit/query';

import {LearningPathType} from '@/constants';
import {
  useCreateCaseSessionMutation,
  useCreatePathSessionMutation,
  useGetCaseDetailsQuery,
  useGetSimulationPathDetailsQuery,
  useLazyGetScenarioSessionByCaseItemQuery,
  useLazyGetScenarioSessionByPathItemQuery,
} from '@/services';
import type {CaseDetails, SimulationPathDetails} from '@/types';

interface UseLearningPathDetailsParams {
  id: string;
  type: LearningPathType;
}

interface UseLearningPathDetailsReturn {
  data: SimulationPathDetails | CaseDetails | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  error: FetchBaseQueryError | SerializedError | undefined;
  refetch: () => Promise<void>;
  createSession: () => Promise<void>;
  isCreatingSession: boolean;
  getSessionByItem: (itemId: string) => Promise<{id: string} | undefined>;
}

/**
 * Shared hook for fetching and managing learning path details
 * Works for both Tracks and Cases with identical logic
 */
export const useLearningPathDetails = ({
  id,
  type,
}: UseLearningPathDetailsParams): UseLearningPathDetailsReturn => {
  const [isRefreshing, setisRefreshing] = useState(false);

  // Conditional API hooks based on type
  const {
    data: trackData,
    isLoading: isLoadingTrack,
    error: trackError,
    refetch: refetchTrack,
  } = useGetSimulationPathDetailsQuery(
    {pathId: id},
    {skip: type !== LearningPathType.TRACK},
  );

  const {
    data: caseData,
    isLoading: isLoadingCase,
    error: caseError,
    refetch: refetchCase,
  } = useGetCaseDetailsQuery(
    {caseId: id},
    {skip: type !== LearningPathType.CASE},
  );

  const [createPathSession, {isLoading: isCreatingPathSession}] =
    useCreatePathSessionMutation();
  const [createCaseSession, {isLoading: isCreatingCaseSession}] =
    useCreateCaseSessionMutation();

  const [getScenarioSessionByPathItem] =
    useLazyGetScenarioSessionByPathItemQuery();
  const [getScenarioSessionByCaseItem] =
    useLazyGetScenarioSessionByCaseItemQuery();

  // Normalize data structure
  const data = type === LearningPathType.TRACK ? trackData : caseData;
  const isLoading =
    type === LearningPathType.TRACK ? isLoadingTrack : isLoadingCase;
  const error = type === LearningPathType.TRACK ? trackError : caseError;
  const isCreatingSession =
    type === LearningPathType.TRACK
      ? isCreatingPathSession
      : isCreatingCaseSession;

  const refetch = useCallback(async () => {
    setisRefreshing(true);
    try {
      if (type === LearningPathType.TRACK) {
        await refetchTrack();
      } else {
        await refetchCase();
      }
    } finally {
      setisRefreshing(false);
    }
  }, [type, refetchTrack, refetchCase]);

  const createSession = useCallback(async () => {
    if (type === LearningPathType.TRACK) {
      await createPathSession({pathId: id}).unwrap();
    } else {
      await createCaseSession({caseId: id}).unwrap();
    }
  }, [type, id, createPathSession, createCaseSession]);

  const getSessionByItem = useCallback(
    async (itemId: string) => {
      if (type === LearningPathType.TRACK) {
        const response = await getScenarioSessionByPathItem({
          pathSessionItemId: itemId,
        }).unwrap();
        return response;
      } else {
        const response = await getScenarioSessionByCaseItem({
          caseSessionItemId: itemId,
        }).unwrap();
        return response;
      }
    },
    [type, getScenarioSessionByPathItem, getScenarioSessionByCaseItem],
  );

  return {
    data,
    isRefreshing,
    isLoading,
    error,
    refetch,
    createSession,
    isCreatingSession,
    getSessionByItem,
  };
};

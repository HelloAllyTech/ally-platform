import {useEffect} from 'react';

import {USER_PERMISSIONS} from '@/constants';
import {useLazyGetSimulationCreditsQuery} from '@/services';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCredits, setCredits} from '@/store/slices/creditsSlice';
import {SimulationCredits} from '@/types';
import {areCreditsLow, getCreditUsagePercentage} from '@/utils';

export const useSimulationCredits = () => {
  const dispatch = useAppDispatch();
  const creditsState = useAppSelector(state => state.credits);
  const permissions = useAppSelector(state => state.user.permissions);
  const hasPermission = permissions.includes(
    USER_PERMISSIONS.EDIT_SCENARIO_SESSION,
  );

  const [getSimulationCredits, {data: creditsData}] =
    useLazyGetSimulationCreditsQuery();

  useEffect(() => {
    if (hasPermission) {
      getSimulationCredits();
    } else {
      dispatch(clearCredits());
    }
  }, [hasPermission, getSimulationCredits, dispatch]);

  useEffect(() => {
    if (creditsData) {
      dispatch(setCredits(creditsData));
    }
  }, [dispatch, creditsData]);

  const getCreditsInfo = (credits: SimulationCredits) => ({
    usagePercentage: getCreditUsagePercentage(credits),
    isLow: areCreditsLow(credits),
  });

  return {
    credits: creditsState.credits,
    refreshCredits: getSimulationCredits,
    getCreditsInfo: creditsState.credits
      ? getCreditsInfo(creditsState.credits)
      : null,
  };
};

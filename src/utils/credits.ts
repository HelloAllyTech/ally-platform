import {MINUTES_IN_SECONDS, SESSION_AUTO_END_MINUTES} from '@/constants';
import {SimulationCredits} from '@/types';

// Helper function to check if credits are low (less than 20 minutes)
export const areCreditsLow = (credits: SimulationCredits): boolean => {
  const remainingCredits = credits.creditLimit - credits.consumedCredits;
  const remainingTimeInSeconds =
    remainingCredits * credits.secondsAllowedPerCredit;
  return remainingTimeInSeconds < SESSION_AUTO_END_MINUTES * MINUTES_IN_SECONDS;
};

export const getCreditUsagePercentage = (
  credits: SimulationCredits,
): number => {
  if (credits.creditLimit === 0) return 0;
  return Math.round((credits.consumedCredits / credits.creditLimit) * 100);
};

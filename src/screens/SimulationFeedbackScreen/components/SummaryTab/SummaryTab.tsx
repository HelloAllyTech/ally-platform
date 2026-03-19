import React, {useMemo, useRef} from 'react';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {SimulationSummaryData} from '@/types';

import {SimulationSummary, SimulationSummarySkeleton} from '../';
import {getImprovementsWithRecommendations} from '../../utils/simulationSummary';

interface SummaryTabProps {
  simulationDetails: SimulationSummaryData | null;
  retryLimitReached: boolean;
}

export const SummaryTab: React.FC<SummaryTabProps> = ({
  simulationDetails,
  retryLimitReached,
}) => {
  const scrollViewRef = useRef<KeyboardAwareScrollView>(null);

  const positives = useMemo(
    () => simulationDetails?.details?.summary?.feedback?.positives ?? [],
    [simulationDetails?.details?.summary?.feedback?.positives],
  );

  const improvements = useMemo(
    () => getImprovementsWithRecommendations(simulationDetails),
    [simulationDetails],
  );

  return (
    <KeyboardAwareScrollView
      ref={scrollViewRef}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      extraScrollHeight={100}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}>
      {!simulationDetails?.details && !retryLimitReached ? (
        <SimulationSummarySkeleton />
      ) : (
        <SimulationSummary
          data={simulationDetails ?? null}
          positives={positives}
          improvements={improvements}
        />
      )}
    </KeyboardAwareScrollView>
  );
};

const styles = ScaledSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingBottom: '40@vs',
  },
  buttonContainer: {
    marginTop: '24@vs',
  },
  submitButton: {
    width: '90%',
    alignSelf: 'center',
  },
});

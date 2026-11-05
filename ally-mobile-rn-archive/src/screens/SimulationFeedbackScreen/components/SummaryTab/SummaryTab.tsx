import React, {useRef} from 'react';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {SimulationSummaryData} from '@/types';

import {SimulationSummary, SimulationSummarySkeleton} from '../';

interface SummaryTabProps {
  simulationDetails: SimulationSummaryData | null;
  retryLimitReached: boolean;
}

// Now reached only for short sessions (see getSimulationSummaryTabs) — the
// full-length "Session Review" surface this used to host was retired in
// favour of Ally's debrief note (see components/Debrief).
export const SummaryTab: React.FC<SummaryTabProps> = ({
  simulationDetails,
  retryLimitReached,
}) => {
  const scrollViewRef = useRef<KeyboardAwareScrollView>(null);

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
        <SimulationSummary data={simulationDetails ?? null} />
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

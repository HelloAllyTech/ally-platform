import React, {useRef} from 'react';
import {View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {SimulationSummaryData} from '@/types';

import {SimulationSummary, SimulationSummarySkeleton} from '../';

interface SummaryTabProps {
  simulationDetails: SimulationSummaryData | null;
  retryLimitReached: boolean;
  pathId?: string;
  caseId?: string;
  fromLogs?: boolean;
  onTryAnother: () => void;
}

export const SummaryTab: React.FC<SummaryTabProps> = ({
  simulationDetails,
  retryLimitReached,
  pathId,
  caseId,
  fromLogs,
  onTryAnother,
}) => {
  const {t} = useTranslate();
  const scrollViewRef = useRef<KeyboardAwareScrollView>(null);

  const renderButtonContainer = () => {
    // For normal simulations (not paths/cases), show "Try Another" button
    if (!pathId && !caseId && !fromLogs) {
      return (
        <View style={styles.buttonContainer}>
          <Button
            label={t('SimulationFeedback.tryAnother')}
            onPress={onTryAnother}
            customContainerStyle={styles.submitButton}
          />
        </View>
      );
    }
    return null;
  };

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
        <>
          <SimulationSummary data={simulationDetails ?? null} />
          {simulationDetails && renderButtonContainer()}
        </>
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

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {useLazyGetSimulationDetailsQuery} from '@/services';

import {SimulationSummary, SimulationSummarySkeleton} from '../';

interface SummaryTabProps {
  scenarioSessionId?: string;
  pathId?: string;
  caseId?: string;
  fromLogs?: boolean;
  onTryAnother: () => void;
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000;

export const SummaryTab: React.FC<SummaryTabProps> = ({
  scenarioSessionId,
  pathId,
  caseId,
  fromLogs,
  onTryAnother,
}) => {
  const {t} = useTranslate();
  const scrollViewRef = useRef<KeyboardAwareScrollView>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [retryLimitReached, setRetryLimitReached] = useState<boolean>(false);

  const [getSimulationDetails, {data: simulationDetails}] =
    useLazyGetSimulationDetailsQuery();

  const fetchSimulationDetailsWithRetry = useCallback(
    async (retryCount = 0) => {
      if (!scenarioSessionId) return;

      try {
        const response = await getSimulationDetails({
          id: scenarioSessionId,
        }).unwrap();

        if (!response?.details && retryCount < MAX_RETRY_ATTEMPTS) {
          retryTimeoutRef.current = setTimeout(() => {
            fetchSimulationDetailsWithRetry(retryCount + 1);
          }, RETRY_DELAY);
        } else if (retryCount >= MAX_RETRY_ATTEMPTS) {
          setRetryLimitReached(true);
        }
      } catch (error) {
        console.error('Error fetching simulation details:', error);
        if (retryCount < MAX_RETRY_ATTEMPTS) {
          retryTimeoutRef.current = setTimeout(() => {
            fetchSimulationDetailsWithRetry(retryCount + 1);
          }, RETRY_DELAY);
        } else {
          setRetryLimitReached(true);
        }
      }
    },
    [scenarioSessionId, getSimulationDetails],
  );

  useEffect(() => {
    fetchSimulationDetailsWithRetry();

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [fetchSimulationDetailsWithRetry]);

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

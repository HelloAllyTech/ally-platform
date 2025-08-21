import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ShieldWithTickIcon} from '@/assets';
import {ShinyText} from '@/components';
import {SUMMARY_GENERATION_STEPS, SummaryGenerationStep} from '@/constants';
import {useTranslate} from '@/hooks';
import {useAppSelector} from '@/store/hooks';
import {colors, fontFamily} from '@/theme';

export const SummaryStatusTexts: React.FC = () => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hasCompletedAllSteps, setHasCompletedAllSteps] = useState(false);

  const {t} = useTranslate();
  const currentChat = useAppSelector(state => state.chat.currentChat);
  const filteredSteps = useMemo(() => {
    return currentChat
      ? [...SUMMARY_GENERATION_STEPS]
      : [...SUMMARY_GENERATION_STEPS.slice(8, SUMMARY_GENERATION_STEPS.length)];
  }, [currentChat]);

  const changeStep = useCallback(() => {
    if (currentStepIndex === filteredSteps.length - 1) {
      setHasCompletedAllSteps(true);
      return;
    }
    setCurrentStepIndex(prev => prev + 1);
  }, [currentStepIndex, filteredSteps]);

  useEffect(() => {
    const stepInterval = setInterval(() => {
      if (!hasCompletedAllSteps) {
        changeStep();
      }
    }, 3000);

    return () => {
      clearInterval(stepInterval);
    };
  }, [changeStep, hasCompletedAllSteps]);

  const shouldShowGeneratedRow =
    currentStepIndex >=
    filteredSteps.findIndex(
      step => step === SummaryGenerationStep.GENERATING_SUMMARY,
    );

  return (
    <View style={styles.container}>
      <ShinyText style={styles.text}>
        {filteredSteps[currentStepIndex]}...
      </ShinyText>

      {shouldShowGeneratedRow && (
        <View style={styles.generatedRow}>
          <ShieldWithTickIcon />
          <Text style={styles.generatedText}>
            {t('CallSummaryProgress.transcriptionGeneratedAudioDeleted')}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '8@ms',
    marginBottom: '24@ms',
  },
  text: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    color: colors.black,
    textAlign: 'center',
  },
  generatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: '16@ms',
  },
  generatedText: {
    marginLeft: '8@ms',
    color: colors.teal,
    fontSize: '14@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
});

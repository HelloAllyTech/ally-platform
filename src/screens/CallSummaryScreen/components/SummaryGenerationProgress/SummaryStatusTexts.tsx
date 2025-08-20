import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Animated, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ShieldWithTickIcon} from '@/assets';
import {
  SUMMARY_GENERATION_STEPS,
  SummaryGenerationStep,
} from '@/constants/summary';
import {useTranslate} from '@/hooks';
import {useAppSelector} from '@/store/hooks';
import {colors, fontFamily} from '@/theme';

export const SummaryStatusTexts: React.FC = () => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [blinkCount, setBlinkCount] = useState(0);
  const [hasCompletedAllSteps, setHasCompletedAllSteps] = useState(false);

  const fadeAnim = useMemo(() => new Animated.Value(1), []);
  const {t} = useTranslate();
  const currentChat = useAppSelector(state => state.chat.currentChat);
  const filteredSteps = useMemo(() => {
    return currentChat
      ? [...SUMMARY_GENERATION_STEPS]
      : [...SUMMARY_GENERATION_STEPS.slice(8, SUMMARY_GENERATION_STEPS.length)];
  }, [currentChat]);

  const animateBlink = useCallback(() => {
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim]);

  const changeStep = useCallback(() => {
    if (currentStepIndex === filteredSteps.length - 1) {
      setHasCompletedAllSteps(true);
      return;
    }
    setCurrentStepIndex(prev => prev + 1);
    setBlinkCount(0);
  }, [currentStepIndex, filteredSteps]);

  useEffect(() => {
    const blinkInterval = setInterval(() => {
      animateBlink();
      if (!hasCompletedAllSteps) {
        setBlinkCount(prev => prev + 1);
      }
    }, 1000);

    const stepInterval = setInterval(() => {
      if (!hasCompletedAllSteps && blinkCount >= 1) {
        changeStep();
      }
    }, 1000);

    return () => {
      clearInterval(blinkInterval);
      clearInterval(stepInterval);
    };
  }, [blinkCount, animateBlink, changeStep, hasCompletedAllSteps]);

  const shouldShowGeneratedRow =
    currentStepIndex >=
    filteredSteps.findIndex(
      step => step === SummaryGenerationStep.GENERATING_SUMMARY,
    );

  return (
    <View style={styles.container}>
      <Animated.Text style={[styles.text, {opacity: fadeAnim}]}>
        {filteredSteps[currentStepIndex]}...
      </Animated.Text>

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
    marginVertical: '16@ms',
  },
  text: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    color: colors.darkSlate,
    textAlign: 'center',
  },
  generatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: '16@ms',
  },
  generatedText: {
    marginLeft: '8@ms',
    color: colors.teal,
    fontSize: '14@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
});

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {TickRoundIcon} from '@/assets/icons';
import ShinyText from '@/components/ShinyText';
import {WINDOW_HEIGHT} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {TranslationType} from '@/localization/locales/type';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

type CallSummaryProgressProps = {
  onProgressComplete: () => void;
  animationDuration?: number;
};

/**
 * Represents a single step in the call summary generation process
 */
type Step = {
  /** Unique identifier for the step */
  id: string;
  /** Display label for the step */
  label: string;
  /** Whether the step has been completed */
  completed: boolean;
};

/**
 * List of steps in the call summary generation process
 */
const getSteps = (t: (key: TranslationType) => string): Step[] => [
  {
    id: '1',
    label: t('CallSummaryProgress.steps.understandingContext'),
    completed: false,
  },
  {
    id: '2',
    label: t('CallSummaryProgress.steps.analysingConversation'),
    completed: false,
  },
  {
    id: '3',
    label: t('CallSummaryProgress.steps.identifyingKeyPoints'),
    completed: false,
  },
  {
    id: '4',
    label: t('CallSummaryProgress.steps.extractingInsights'),
    completed: false,
  },
  {
    id: '5',
    label: t('CallSummaryProgress.steps.generatingSummary'),
    completed: false,
  },
];

/**
 * Renders a single step item in the progress list with fade-in animation
 * @param item - The step item to render
 * @param onAnimationComplete - Callback when animation completes
 * @returns An Animated.View component representing the step
 */
const StepItem: React.FC<{
  item: Step;
  animationDuration?: number;
  onAnimationComplete: () => void;
}> = ({item, animationDuration, onAnimationComplete}) => {
  useEffect(() => {
    setTimeout(() => {
      onAnimationComplete();
    }, animationDuration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.stepItem}>
      {item.completed ? (
        <>
          <View style={styles.iconContainer}>
            <TickRoundIcon width={20} height={20} />
          </View>
          <Text style={styles.stepLabel}>{item.label}</Text>
        </>
      ) : (
        <>
          <View style={styles.iconContainer}>
            <ActivityIndicator style={styles.loader} />
          </View>
          <ShinyText style={styles.stepLabel}>{item.label}</ShinyText>
        </>
      )}
    </View>
  );
};

export const CallSummaryProgress: React.FC<CallSummaryProgressProps> = ({
  onProgressComplete,
  animationDuration,
}) => {
  const {t} = useTranslate();
  const [visibleSteps, setVisibleSteps] = useState<Step[]>([getSteps(t)[0]]);
  const currentStepIndex = useRef(0);

  const handleAnimationComplete = useCallback(
    (stepId: string) => {
      const nextIndex = currentStepIndex.current + 1;
      const steps = getSteps(t);

      // Use requestAnimationFrame to ensure we're not in a render cycle
      requestAnimationFrame(() => {
        setVisibleSteps(prev =>
          prev.map(step =>
            step.id === stepId && !step.completed
              ? {...step, completed: true}
              : step,
          ),
        );

        if (nextIndex < steps.length) {
          setVisibleSteps(prevSteps => [...prevSteps, steps[nextIndex]]);
          currentStepIndex.current = nextIndex;
        }

        if (nextIndex === steps.length) {
          onProgressComplete();
        }
      });
    },
    [onProgressComplete, t],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.generatingTitle}>
        {t('CallSummaryProgress.generatingSummary')}
      </Text>
      <View>
        {visibleSteps.map((item, index) => (
          <StepItem
            key={`${item.id}-${index}`}
            item={item}
            onAnimationComplete={() => handleAnimationComplete(item.id)}
            animationDuration={animationDuration}
          />
        ))}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: WINDOW_HEIGHT * 0.6,
  },
  generatingTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
    fontWeight: '700',
    color: colors.darkSlate,
    marginBottom: '20@ms',
    textAlign: 'center',
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '14@ms',
  },
  iconContainer: {
    marginRight: '8@ms',
    width: '20@ms',
    height: '20@ms',
  },
  stepLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    color: colors.darkSlate,
  },
  loader: {
    width: '20@ms',
    height: '20@ms',
  },
});

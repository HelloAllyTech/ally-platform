import React from 'react';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {PrimaryButton, SimulationTransitionSection} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, radius} from '@/theme';
import {CurrentSessionInfo, UpNextSimulation} from '@/types';

import {SessionGlimpse} from '../SessionGlimpse';
import {SummaryCard} from '../SummaryCard';

interface UpNextProps {
  currentSession?: CurrentSessionInfo;
  upcomingScenario?: UpNextSimulation;
  isEventCompleted: boolean;
  isFlowCompleted: boolean;
  hasUpcoming: boolean;
  canRetryCurrentSession: boolean;
  isCurrentSessionCompleted: boolean;
  pathId?: string;
  caseId?: string;
  onFinish: () => void;
  onBack: () => void;
  onRetry: () => void;
  onNext: () => void;
  isStartingSimulation: boolean;
}

export const UpNext: React.FC<UpNextProps> = ({
  currentSession,
  upcomingScenario,
  isEventCompleted,
  isFlowCompleted,
  hasUpcoming,
  canRetryCurrentSession,
  isCurrentSessionCompleted,
  pathId,
  caseId,
  onFinish,
  onBack,
  onRetry,
  onNext,
  isStartingSimulation,
}) => {
  const {t} = useTranslate();

  const renderButtons = () => {
    // Only show buttons for paths/cases
    if (!pathId && !caseId) {
      return null;
    }

    if (!isEventCompleted) {
      return null;
    }

    // Path/Case completed: show a single Finish button
    if (isFlowCompleted) {
      return (
        <View style={styles.buttonContainer}>
          <PrimaryButton
            label={t('Common.finish')}
            onPress={onFinish}
            customContainerStyle={styles.submitButton}
          />
        </View>
      );
    }

    // Path/Case in progress: show Back + (Retry or Next)
    return (
      <View style={styles.buttonContainer}>
        <View style={styles.pathNavigationContainer}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBack}
            activeOpacity={0.7}>
            <Text style={styles.backButtonText}>{t('Common.back')}</Text>
          </TouchableOpacity>
          {/* Show either Retry or Next, but never both */}
          {!hasUpcoming && canRetryCurrentSession && (
            <PrimaryButton
              label={t('CallSummaryProgress.retry')}
              onPress={onRetry}
              customContainerStyle={styles.retryButton}
              isLoading={isStartingSimulation}
            />
          )}
          {isCurrentSessionCompleted && hasUpcoming && (
            <PrimaryButton
              label={t('Common.next')}
              onPress={onNext}
              customContainerStyle={styles.nextButton}
              isLoading={isStartingSimulation}
            />
          )}
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}>
      <SummaryCard title={t('SimulationFeedback.tabs.upNext')}>
        {/* Session Glimpse - only for cases */}
        {caseId && currentSession?.sessionGlimpse && (
          <SessionGlimpse content={currentSession.sessionGlimpse} />
        )}

        <SimulationTransitionSection
          currentSession={currentSession}
          upcomingScenario={upcomingScenario}
          isEventCompleted={isEventCompleted}
          isFlowCompleted={isFlowCompleted}
          hasUpcoming={hasUpcoming}
          canRetryCurrentSession={canRetryCurrentSession}
          isCurrentSessionCompleted={isCurrentSessionCompleted}
          almostThereTitle={t('SimulationFeedback.almostThereTitle')}
          almostThereDescription={t(
            'SimulationFeedback.almostThereDescription',
          )}
        />
        {renderButtons()}
      </SummaryCard>
    </ScrollView>
  );
};

const styles = ScaledSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: '10@ms',
    paddingBottom: '40@vs',
  },
  buttonContainer: {
    marginTop: '20@vs',
  },
  pathNavigationContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12@ms',
  },
  backButton: {
    flex: 1,
    paddingVertical: '8@vs',
    borderRadius: radius.full,
    borderWidth: '1@ms',
    borderColor: colors.ds.stroke.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  backButtonText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '16@ms',
    lineHeight: '24@ms',
    color: colors.ds.typography.highEmphasis,
  },
  submitButton: {
    width: '100%',
  },
  retryButton: {
    flex: 1,
  },
  nextButton: {
    flex: 1,
  },
});

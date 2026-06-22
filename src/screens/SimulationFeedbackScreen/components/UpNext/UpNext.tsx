import React from 'react';
import {ScrollView, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button, SimulationTransitionSection} from '@/components';
import {useSimulationTransition, useTranslate} from '@/hooks';
import {RetrySessionModal} from '@/screens/CallLog/components';

import {SessionGlimpse} from '../SessionGlimpse';
import {SummaryCard} from '../SummaryCard';

interface UpNextProps {
  scenarioSessionId: string;
  pathId?: string;
  caseId?: string;
  languageId?: number;
  onFinish: () => void;
  onBack: () => void;
}

export const UpNext: React.FC<UpNextProps> = ({
  scenarioSessionId,
  pathId,
  caseId,
  languageId,
  onFinish,
  onBack,
}) => {
  const {t} = useTranslate();

  // Get transition data and actions from the hook
  const {
    currentSession,
    upcomingScenario,
    isEventCompleted,
    isFlowCompleted,
    hasUpcoming,
    canRetryCurrentSession,
    isCurrentSessionCompleted,
    retrySimulation,
    startNextSimulation,
    isStartingSimulation,
    showRetryModal,
    retryStartSimulation,
    closeRetryModal,
  } = useSimulationTransition({
    scenarioSessionId,
    pathId,
    caseId,
    languageId,
    enabled: !!(pathId || caseId),
  });

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
          <Button
            label={t('common.finish')}
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
          <Button
            label={t('common.backToLearn')}
            onPress={onBack}
            variant="secondary"
            customContainerStyle={styles.button}
          />
          {/* Show either Retry or Next, but never both */}
          {!hasUpcoming && canRetryCurrentSession && (
            <Button
              label={t('common.retry')}
              onPress={retrySimulation}
              customContainerStyle={styles.button}
              isLoading={isStartingSimulation}
            />
          )}
          {isCurrentSessionCompleted && hasUpcoming && (
            <Button
              label={t('common.next')}
              onPress={startNextSimulation}
              customContainerStyle={styles.button}
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
      <SummaryCard title={t('postSim.tabs.upNext')}>
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
          almostThereTitle={t('callFeedback.almostThereTitle')}
          almostThereDescription={t('callFeedback.almostThereDescription')}
        />
        {renderButtons()}
      </SummaryCard>
      <RetrySessionModal
        visible={showRetryModal}
        onRetry={retryStartSimulation}
        onClose={closeRetryModal}
      />
    </ScrollView>
  );
};

const styles = ScaledSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
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
  submitButton: {
    width: '100%',
  },
  button: {
    flex: 1,
  },
});

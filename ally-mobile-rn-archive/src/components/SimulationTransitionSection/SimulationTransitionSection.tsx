import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';
import {CurrentSessionInfo, UpNextSimulation} from '@/types';

import {UpNextSimulationCard} from './UpNextSimulationCard';

interface SimulationTransitionSectionProps {
  currentSession?: CurrentSessionInfo;
  upcomingScenario?: UpNextSimulation;
  isEventCompleted: boolean;
  isFlowCompleted: boolean;
  hasUpcoming: boolean;
  canRetryCurrentSession: boolean;
  isCurrentSessionCompleted: boolean;
  almostThereTitle?: string;
  almostThereDescription?: string;
}

export const SimulationTransitionSection: React.FC<
  SimulationTransitionSectionProps
> = ({
  currentSession,
  upcomingScenario,
  isEventCompleted,
  isFlowCompleted,
  hasUpcoming,
  canRetryCurrentSession,
  isCurrentSessionCompleted,
  almostThereTitle,
  almostThereDescription,
}) => {
  if (!isEventCompleted) {
    return null;
  }

  return (
    <>
      {/* Transition message section */}
      {(currentSession?.transitionMessageTitle ||
        currentSession?.transitionMessageContent) && (
        <View style={styles.transitionMessageContainer}>
          {currentSession?.transitionMessageTitle && (
            <Text style={styles.transitionMessageTitle}>
              {currentSession.transitionMessageTitle}
            </Text>
          )}
          {currentSession?.transitionMessageContent && (
            <Text style={styles.transitionMessageContent}>
              {currentSession.transitionMessageContent}
            </Text>
          )}
        </View>
      )}

      {/* Almost there retry message */}
      {!isFlowCompleted && !hasUpcoming && canRetryCurrentSession && (
        <>
          {almostThereTitle && (
            <Text style={styles.transitionMessageTitle}>
              {almostThereTitle}
            </Text>
          )}
          {almostThereDescription && (
            <Text style={styles.transitionMessageContent}>
              {almostThereDescription}
            </Text>
          )}
        </>
      )}

      {/* Up next simulation card */}
      {isCurrentSessionCompleted && !!upcomingScenario && (
        <UpNextSimulationCard upNext={upcomingScenario} />
      )}
    </>
  );
};

const styles = ScaledSheet.create({
  transitionMessageContainer: {
    marginBottom: '16@vs',
  },
  transitionMessageTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '8@vs',
  },
  transitionMessageContent: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
});

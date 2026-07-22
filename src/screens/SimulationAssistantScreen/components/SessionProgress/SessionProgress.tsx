import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {fontFamily} from '@/theme';
import {StateInstruction} from '@/types';

import {STATE_COLORS} from './constants';
import {getCurrentStateIndex} from './utils';

export interface SessionProgressProps {
  stateNames: StateInstruction[];
  difficultyLevel: string;
  score: number;
}

/**
 * Vertical state-name stepper — every state gets its own row (dot + label +
 * connecting line), so no label needs to be truncated or wrapped into a
 * cramped fixed-width column the way a horizontal timeline would. Mirrors
 * ally-web's SessionProgress (libs/ui-shared simulation), ported here since
 * mobile has no equivalent state-progress feature yet.
 */
export const SessionProgress: React.FC<SessionProgressProps> = ({
  stateNames,
  difficultyLevel,
  score,
}) => {
  if (stateNames.length === 0) return null;

  const currentStateIndex = getCurrentStateIndex(score, difficultyLevel);

  return (
    <View style={styles.container} testID="session-progress">
      {stateNames.map((state, index) => {
        const isActive = index === currentStateIndex;
        const isCompleted = index < currentStateIndex;
        const isLast = index === stateNames.length - 1;

        return (
          <View
            key={state.stateId}
            testID={`session-progress-state-${state.stateId}`}
            style={[styles.row, isLast && styles.rowLast]}>
            {!isLast && (
              <View
                style={[
                  styles.connector,
                  isCompleted
                    ? styles.connectorCompleted
                    : styles.connectorInactive,
                ]}
              />
            )}
            <View
              testID={`session-progress-dot-${state.stateId}`}
              style={[
                styles.dot,
                isActive ? styles.dotActive : styles.dotInactive,
                isActive
                  ? styles.dotActiveColor
                  : isCompleted
                    ? styles.dotCompletedColor
                    : styles.dotInactiveColor,
              ]}
            />
            <Text
              style={[
                styles.label,
                isActive
                  ? styles.labelActive
                  : isCompleted
                    ? styles.labelCompleted
                    : styles.labelInactive,
              ]}>
              {state.name}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    backgroundColor: '#1d2020',
    borderRadius: '8@ms',
    padding: '12@ms',
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
    paddingBottom: '10@vs',
  },
  rowLast: {
    paddingBottom: 0,
  },
  connector: {
    position: 'absolute',
    left: '6@ms',
    top: '50%',
    bottom: '-10@vs',
    width: '2@ms',
  },
  connectorCompleted: {
    backgroundColor: STATE_COLORS.completed,
  },
  connectorInactive: {
    backgroundColor: STATE_COLORS.inactive,
  },
  dot: {
    borderRadius: '999@ms',
    zIndex: 1,
  },
  dotActive: {
    width: '14@ms',
    height: '14@ms',
  },
  dotInactive: {
    width: '10@ms',
    height: '10@ms',
  },
  dotActiveColor: {
    backgroundColor: STATE_COLORS.active,
  },
  dotCompletedColor: {
    backgroundColor: STATE_COLORS.completed,
  },
  dotInactiveColor: {
    backgroundColor: STATE_COLORS.inactive,
  },
  label: {
    fontSize: '12@ms',
    lineHeight: '16@ms',
    flexShrink: 1,
    fontWeight: '500',
    ...fontFamily.ROBOTO.REGULAR,
  },
  labelActive: {
    color: STATE_COLORS.active,
    fontWeight: '600',
  },
  labelCompleted: {
    color: '#9CA3AF',
  },
  labelInactive: {
    color: '#6B7280',
  },
});

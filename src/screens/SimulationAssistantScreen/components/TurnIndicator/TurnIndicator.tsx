import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';
import {TurnState} from '@/types';

interface TurnIndicatorProps {
  turnState: TurnState;
}

const getLabel = (state: TurnState): string => {
  switch (state) {
    case TurnState.AI_SPEAKING:
      return 'Speaking...';
    case TurnState.AI_LISTENING:
      return 'Listening...';
    case TurnState.USER_TURN_TO_SPEAK:
      return 'Your turn to speak';
    case TurnState.USER_TURN_TO_LISTEN:
      return 'Your turn to listen';
    case TurnState.THINKING:
      return 'Thinking...';
    case TurnState.PAUSED:
      return 'Paused';
    default:
      return '';
  }
};

export const TurnIndicator: React.FC<TurnIndicatorProps> = ({turnState}) => {
  const label = getLabel(turnState);
  if (!label || turnState === TurnState.IDLE) return null;

  const isUserAction = turnState === TurnState.USER_TURN_TO_SPEAK;

  return (
    <View
      style={[
        styles.container,
        isUserAction ? styles.bgPrimaryLight : styles.bgPrimary,
      ]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingHorizontal: '10@ms',
    paddingVertical: '5@ms',
    borderRadius: '6@ms',
  },
  bgPrimary: {
    backgroundColor: colors.ds.theme.primary,
  },
  bgPrimaryLight: {
    backgroundColor: colors.ds.theme.primaryLight,
  },
  label: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '11@ms',
    color: colors.white,
    fontStyle: 'italic',
  },
});

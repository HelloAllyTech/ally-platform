import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks/useTranslate';
import type {TranslationType} from '@/localization/locales/type';
import {colors, fontFamily} from '@/theme';
import {TurnState} from '@/types';

interface TurnIndicatorProps {
  turnState: TurnState;
}

const getLabelKey = (state: TurnState): TranslationType | null => {
  switch (state) {
    case TurnState.AI_SPEAKING:
      return 'simulationPage.turnIndicator.speaking';
    case TurnState.AI_LISTENING:
      return 'simulationPage.turnIndicator.listening';
    case TurnState.USER_TURN_TO_SPEAK:
      return 'simulationPage.turnIndicator.yourTurnToSpeak';
    case TurnState.USER_TURN_TO_LISTEN:
      return 'simulationPage.turnIndicator.yourTurnToListen';
    case TurnState.THINKING:
      return 'simulationPage.turnIndicator.thinking';
    case TurnState.PAUSED:
      return 'simulationPage.turnIndicator.paused';
    default:
      return null;
  }
};

export const TurnIndicator: React.FC<TurnIndicatorProps> = ({turnState}) => {
  const {t} = useTranslate();
  const labelKey = getLabelKey(turnState);
  const label = labelKey ? t(labelKey) : '';
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

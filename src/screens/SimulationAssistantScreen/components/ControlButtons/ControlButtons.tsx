import React from 'react';
import {useTranslation} from 'react-i18next';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {MicOffIcon, MicOnIcon} from '@/assets';
import {colors, fontFamily} from '@/theme';
import {ControlButtonsProps} from '@/types';

export const ControlButtons: React.FC<ControlButtonsProps> = ({
  onMicPress,
  onStopPress,
  isDisableMic = false,
  isDisableStop = false,
  isMuted,
}) => {
  const {t} = useTranslation();
  return (
    <View style={styles.controlButtonsContainer}>
      <TouchableOpacity
        onPress={onMicPress}
        disabled={isDisableMic}
        style={[styles.buttonHalf, isMuted && styles.buttonMuted]}>
        {isMuted ? <MicOffIcon /> : <MicOnIcon />}
        <Text style={[styles.buttonText, isMuted && styles.buttonTextDark]}>
          {isMuted
            ? t('SimulationAssistant.unmute')
            : t('SimulationAssistant.mute')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onStopPress}
        disabled={isDisableStop}
        style={styles.buttonHalf}>
        <View style={styles.stopIcon} />
        <Text style={styles.buttonText}>
          {t('SimulationAssistant.endSession')}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  controlButtonsContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: '24@mvs',
    flexDirection: 'row',
    gap: '8@ms',
    justifyContent: 'space-between',
  },
  buttonHalf: {
    flex: 1,
    backgroundColor: colors.darkGray10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '54@ms',
    borderRadius: '8@ms',
    gap: '8@ms',
  },
  buttonText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.white,
  },
  buttonTextDark: {
    color: colors.darkGray5,
  },
  stopIcon: {
    width: '12@s',
    height: '12@s',
    backgroundColor: colors.coralRed,
    borderRadius: '2@ms',
  },
  buttonMuted: {
    backgroundColor: colors.white3,
  },
});

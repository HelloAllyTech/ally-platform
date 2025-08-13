import React from 'react';
import {TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CallEndIcon, MicIcon} from '@/assets';
import {colors} from '@/theme';
import {ControlButtonsProps} from '@/types';

export const ControlButtons: React.FC<ControlButtonsProps> = ({
  onMicPress,
  onStopPress,
  isMuted,
}) => {
  return (
    <View style={styles.controlButtonsContainer}>
      <View style={styles.controlButton}>
        <View style={styles.buttonContent}>
          <TouchableOpacity
            onPress={onMicPress}
            style={[styles.micButton, isMuted && styles.micButtonDisabled]}>
            <MicIcon
              width={20}
              height={20}
              color={isMuted ? colors.white : colors.black}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={onStopPress} style={styles.stopButton}>
            <CallEndIcon width={20} height={20} color={colors.white} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  controlButtonsContainer: {
    alignItems: 'center',
    marginBottom: '40@mvs',
  },
  controlButton: {
    backgroundColor: colors.white,
    borderRadius: '20@ms',
    padding: '12@ms',
    paddingHorizontal: '16@ms',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
  },
  stopButton: {
    backgroundColor: colors.brightRed,
    borderRadius: '4@ms',
    padding: '4@ms',
  },
  micButton: {
    backgroundColor: colors.white,
    borderRadius: '4@ms',
    padding: '4@ms',
  },
  micButtonDisabled: {
    backgroundColor: colors.azureBlue,
  },
});

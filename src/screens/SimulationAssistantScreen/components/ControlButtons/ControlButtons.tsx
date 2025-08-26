import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {MicIcon} from '@/assets';
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
        <TouchableOpacity
          onPress={onMicPress}
          style={[styles.buttonHalf, isMuted && styles.buttonHalfMuted]}>
          <MicIcon width={20} height={20} color={colors.gray} />
          <Text style={styles.buttonText}>Mute</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity onPress={onStopPress} style={styles.buttonHalf}>
          <View style={styles.stopIcon}>
            <View style={styles.stopIconInner} />
          </View>
          <Text style={styles.buttonText}>End session</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  controlButtonsContainer: {
    alignItems: 'center',
    marginBottom: '40@mvs',
    marginHorizontal: '20@ms',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  controlButton: {
    backgroundColor: colors.white,
    borderRadius: '10@ms',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  buttonHalf: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: '12@ms',
    paddingHorizontal: '16@ms',
    gap: '8@ms',
  },
  divider: {
    width: 1,
    height: '100%',
    backgroundColor: colors.lightGray7,
  },
  buttonText: {
    fontSize: '14@ms',
    color: colors.black,
    fontWeight: '400',
  },
  stopIcon: {
    width: 20,
    height: 20,
    backgroundColor: colors.brightRed,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopIconInner: {
    width: 8,
    height: 8,
    backgroundColor: colors.white,
    borderRadius: 1,
  },
  buttonHalfMuted: {
    opacity: 0.5,
  },
});

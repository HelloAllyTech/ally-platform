import React from 'react';
import {View, TouchableOpacity} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import {CallEndIcon, MicIcon, MicWithGradientIcon} from '@/assets/icons';
import {colors} from '@/theme/colors';

interface ControlButtonsProps {
  onFocusModeButtonPress: () => void;
  isNudgeVisible: boolean;
  showFocusModeButton?: boolean;
}

export const ControlButtons: React.FC<ControlButtonsProps> = ({
  onFocusModeButtonPress,
  isNudgeVisible,
  showFocusModeButton = true,
}) => {
  return (
    <View style={styles.container}>
      {showFocusModeButton && (
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.button}
            onPress={onFocusModeButtonPress}
            activeOpacity={1}>
            {isNudgeVisible ? (
              <LinearGradient
                colors={[colors.steelBlue, colors.charcoal]}
                style={styles.gradientButton}>
                <MicWithGradientIcon width={40} height={40} />
              </LinearGradient>
            ) : (
              <MicIcon width={62} height={62} color={colors.darkBlue} />
            )}
          </TouchableOpacity>
        </View>
      )}
      <TouchableOpacity style={[styles.buttonContainer, styles.rightButton]}>
        <CallEndIcon width={35} height={35} color={colors.darkBlue} />
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16@s',
    paddingBottom: '78@vs',
    paddingTop: '16@vs',
  },
  buttonContainer: {
    width: '60@ms',
    height: '60@ms',
    borderRadius: '30@ms',
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradientButton: {
    width: '100%',
    height: '100%',
    borderRadius: '30@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rightButton: {
    backgroundColor: colors.brightRed,
  },
});

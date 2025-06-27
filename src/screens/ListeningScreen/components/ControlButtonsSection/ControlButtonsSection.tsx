import React from 'react';
import {Animated, Easing, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CallEndIcon, ChevronDown, MicIcon} from '@/assets/icons';
import {DEFAULT_HIT_SLOP} from '@/constants/general';
import {colors} from '@/theme/colors';

interface ControlButtonsSectionProps {
  onFocusModeButtonPress: () => void;
  isMaximized: boolean;
  isFocusMode: boolean;
  onToggleMaximized: () => void;
  onCallEndPress: () => void;
}

export const ControlButtonsSection: React.FC<ControlButtonsSectionProps> = ({
  isMaximized,
  onToggleMaximized,
  isFocusMode,
  onCallEndPress,
  onFocusModeButtonPress,
}) => {
  const translateY = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(translateY, {
      toValue: isMaximized ? 0 : 20,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isMaximized, translateY]);

  return (
    <Animated.View
      style={[styles.sectionContainer, {transform: [{translateY}]}]}>
      <TouchableOpacity
        style={styles.toggleIconContainer}
        onPress={onToggleMaximized}
        activeOpacity={0.8}>
        <ChevronDown width={24} height={12} color={colors.lightGrayD9} />
      </TouchableOpacity>
      {isMaximized && (
        <>
          <View style={styles.buttonsRow}>
            <TouchableOpacity
              style={[styles.buttonContainer, isFocusMode && styles.bgWhite]}
              onPress={onFocusModeButtonPress}
              activeOpacity={1}
              hitSlop={DEFAULT_HIT_SLOP}>
              <MicIcon color={isFocusMode ? colors.black : colors.white} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buttonContainer, styles.callEndButton]}
              onPress={onCallEndPress}
              activeOpacity={0.85}>
              <CallEndIcon width={35} height={35} color={colors.white} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </Animated.View>
  );
};

const styles = ScaledSheet.create({
  sectionContainer: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.darkGray3,
    borderRadius: '24@ms',
    paddingVertical: '8@mvs',
    minHeight: '44@ms',
  },
  buttonContainer: {
    width: '56@ms',
    height: '56@ms',
    borderRadius: '30@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bgWhite: {
    backgroundColor: colors.white,
  },
  toggleIconContainer: {
    width: '48@ms',
    height: '32@mvs',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '20@mvs',
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16@s',
    marginBottom: '50@vs',
  },
  callEndButton: {
    backgroundColor: colors.brightRed,
  },
});

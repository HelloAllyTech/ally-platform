import React from 'react';
import {Animated, Easing, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ChevronDown, MicIcon, MicOffIcon, MicOnIcon} from '@/assets';
import {DEFAULT_HIT_SLOP} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';
import {ControlButtonsProps} from '@/types';

export const ControlButtons: React.FC<ControlButtonsProps> = ({
  isMaximized,
  onToggleMaximized,
  isFocusMode,
  onFocusModeButtonPress,
  isSimulationEndDisabled = false,
  onSimulationEndPress,
  isMicDisabled = false,
  onMicButtonPress,
  isMuted,
}) => {
  const {t} = useTranslate();
  const animatedOpacity = React.useRef(new Animated.Value(0)).current;
  const chevronRotation = React.useRef(new Animated.Value(0)).current;
  const [contentHeight, setContentHeight] = React.useState(0);

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(animatedOpacity, {
        toValue: isMaximized ? 1 : 0,
        duration: 100,
        easing: Easing.bezier(0.4, 0.0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.spring(chevronRotation, {
        toValue: isMaximized ? 0 : 1,
        useNativeDriver: true,
        tension: 50,
        friction: 7,
      }),
    ]).start();
  }, [isMaximized, animatedOpacity, chevronRotation]);

  const rotateInterpolate = chevronRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <View style={styles.sectionContainer}>
      <TouchableOpacity
        style={styles.toggleIconContainer}
        onPress={onToggleMaximized}
        activeOpacity={0.8}
        hitSlop={DEFAULT_HIT_SLOP}>
        <Animated.View
          style={{
            transform: [{rotate: rotateInterpolate}],
          }}>
          <ChevronDown width={24} height={12} color={colors.lightGrayD9} />
        </Animated.View>
      </TouchableOpacity>
      {isMaximized && (
        <Animated.View
          style={[
            styles.contentWrapper,
            {
              opacity: animatedOpacity,
            },
          ]}
          onLayout={e => {
            const {height} = e.nativeEvent.layout;
            if (contentHeight === 0) {
              setContentHeight(height);
            }
          }}>
          <View style={styles.buttonsColumn}>
            {/* Mute/Unmute Button */}
            <TouchableOpacity
              style={[
                styles.buttonContainer,
                isMuted && {backgroundColor: colors.white},
                isMicDisabled && styles.disabledOpacity,
              ]}
              onPress={onMicButtonPress}
              disabled={isMicDisabled}
              activeOpacity={0.85}
              hitSlop={DEFAULT_HIT_SLOP}>
              {isMuted ? <MicOffIcon /> : <MicOnIcon />}
              <Text
                style={[
                  styles.buttonText,
                  isMuted && {color: colors.darkGray5},
                ]}>
                {t(`SimulationAssistant.${isMuted ? 'unmute' : 'mute'}`)}
              </Text>
            </TouchableOpacity>

            {/* Focus Mode Button */}
            <TouchableOpacity
              style={[
                styles.buttonContainer,
                isFocusMode && {backgroundColor: colors.white},
              ]}
              onPress={onFocusModeButtonPress}
              activeOpacity={0.85}
              hitSlop={DEFAULT_HIT_SLOP}>
              <MicIcon color={isFocusMode ? colors.black : colors.white} />
              <Text
                style={[
                  styles.buttonText,
                  isFocusMode && {color: colors.darkGray5},
                ]}>
                {t(`ListeningScreen.${isFocusMode ? 'focused' : 'focus'}`)}
              </Text>
            </TouchableOpacity>

            {/* End Session Button */}
            <TouchableOpacity
              style={[
                styles.buttonContainer,
                styles.endSessionButton,
                isSimulationEndDisabled && styles.disabledOpacity,
              ]}
              onPress={onSimulationEndPress}
              disabled={isSimulationEndDisabled}
              activeOpacity={0.85}
              hitSlop={DEFAULT_HIT_SLOP}>
              <View style={styles.redSquareIcon} />
              <Text style={styles.buttonText}>
                {t('SimulationAssistant.endSession')}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  sectionContainer: {
    width: '100%',
    alignItems: 'center',
    borderRadius: '24@ms',
    paddingTop: '8@mvs',
    paddingHorizontal: '21@s',
    minHeight: '44@ms',
  },
  contentWrapper: {
    width: '100%',
    overflow: 'hidden',
  },
  buttonsColumn: {
    width: '100%',
    gap: '8@s',
  },
  buttonContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: '16@vs',
    backgroundColor: colors.darkGray10,
    gap: '10@s',
    borderRadius: '8@ms',
  },
  disabledOpacity: {
    opacity: 0.5,
  },
  buttonText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.white,
  },
  redSquareIcon: {
    width: '16@s',
    height: '16@s',
    backgroundColor: colors.coralRed,
    borderRadius: '2@ms',
  },
  toggleIconContainer: {
    width: '48@ms',
    height: '32@mvs',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '12@mvs',
  },
  endSessionButton: {
    backgroundColor: colors.darkGray10,
    marginBottom: '10@mvs',
  },
});

import React from 'react';
import {Animated, Easing, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  ChevronDown,
  MicIcon,
  PauseIcon,
  ResumeIcon,
  ShieldIcon,
} from '@/assets/icons';
import {DEFAULT_HIT_SLOP} from '@/constants/general';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

interface ControlButtonsSectionProps {
  onFocusModeButtonPress: () => void;
  isMaximized: boolean;
  isFocusMode: boolean;
  onToggleMaximized: () => void;
  onCallEndPress: () => void;
  isCallEndDisabled?: boolean;
  isPauseResumeDisabled?: boolean;
  isCallPaused?: boolean;
  onPauseResumePress: () => void;
  showPauseResumeButton?: boolean;
  showEndSessionButton?: boolean;
  showFocusModeButton?: boolean;
}

export const ControlButtonsSection: React.FC<ControlButtonsSectionProps> = ({
  isMaximized,
  onToggleMaximized,
  isFocusMode,
  onCallEndPress,
  onFocusModeButtonPress,
  isCallEndDisabled = false,
  isPauseResumeDisabled = false,
  isCallPaused = false,
  onPauseResumePress,
  showPauseResumeButton = true,
  showEndSessionButton = true,
  showFocusModeButton = false,
}) => {
  const {t} = useTranslate();
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
        <Animated.View
          style={{
            transform: [{rotate: isMaximized ? '0deg' : '180deg'}],
          }}>
          <ChevronDown width={24} height={12} color={colors.lightGrayD9} />
        </Animated.View>
      </TouchableOpacity>
      {isMaximized && (
        <>
          <View style={styles.buttonsColumn}>
            {/* Pause/Resume Transcription Button */}
            {showPauseResumeButton && (
              <TouchableOpacity
                style={[
                  styles.buttonContainer,
                  isCallPaused && {backgroundColor: colors.white},
                  isPauseResumeDisabled && styles.disabledOpacity,
                ]}
                onPress={onPauseResumePress}
                disabled={isPauseResumeDisabled}
                activeOpacity={0.85}
                hitSlop={DEFAULT_HIT_SLOP}>
                {isCallPaused ? (
                  <ResumeIcon width={24} height={24} />
                ) : (
                  <PauseIcon width={24} height={24} color={colors.white} />
                )}
                <Text
                  style={[
                    styles.buttonText,
                    isCallPaused && {color: colors.darkGray5},
                  ]}>
                  {t(
                    `listeningScreen.${isCallPaused ? 'resumeTranscription' : 'pauseTranscription'}`,
                  )}
                </Text>
              </TouchableOpacity>
            )}

            {/* Focus Mode Button */}
            {showFocusModeButton && (
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
                  {t(`listeningScreen.${isFocusMode ? 'focused' : 'focus'}`)}
                </Text>
              </TouchableOpacity>
            )}

            {/* End Session Button */}
            {showEndSessionButton && (
              <TouchableOpacity
                style={styles.buttonContainer}
                onPress={onCallEndPress}
                disabled={isCallEndDisabled}
                activeOpacity={0.85}
                hitSlop={DEFAULT_HIT_SLOP}>
                <View style={styles.redSquareIcon} />
                <Text style={styles.buttonText}>
                  {t('listeningScreen.endSession')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.securityContainer}>
            <ShieldIcon width={16} height={16} color={colors.lightGrayD9} />
            <Text style={styles.securityText}>
              {t('listeningScreen.dataSafe')}
            </Text>
          </View>
        </>
      )}
    </Animated.View>
  );
};

const styles = ScaledSheet.create({
  sectionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.darkGray3,
    borderRadius: '24@ms',
    paddingVertical: '8@mvs',
    paddingHorizontal: '21@s',
    minHeight: '44@ms',
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
  securityText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '12@ms',
    color: colors.white,
  },
  securityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@s',
    marginTop: '24@vs',
    marginBottom: '16@vs',
  },
});

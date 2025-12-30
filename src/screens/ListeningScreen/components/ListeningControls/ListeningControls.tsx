import React, {useMemo} from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {MicIcon, PauseIcon, ResumeIcon, ShieldIcon} from '@/assets/icons';
import {CollapsibleButtonGroup} from '@/components';
import type {ButtonOption} from '@/components/ButtonGroup';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

interface ListeningControlsProps {
  isMaximized: boolean;
  onToggleMaximized: () => void;
  isFocusMode: boolean;
  onFocusModeButtonPress: () => void;
  isCallPaused: boolean;
  onPauseResumePress: () => void;
  onCallEndPress: () => void;
  showPauseResumeButton?: boolean;
  showFocusModeButton?: boolean;
  showEndSessionButton?: boolean;
  isPauseResumeDisabled?: boolean;
  isCallEndDisabled?: boolean;
}

export const ListeningControls: React.FC<ListeningControlsProps> = ({
  isMaximized,
  onToggleMaximized,
  isFocusMode,
  onFocusModeButtonPress,
  isCallPaused,
  onPauseResumePress,
  onCallEndPress,
  showPauseResumeButton = true,
  showFocusModeButton = false,
  showEndSessionButton = true,
  isPauseResumeDisabled = false,
  isCallEndDisabled = false,
}) => {
  const {t} = useTranslate();

  const buttons: ButtonOption[] = useMemo(() => {
    const buttonList: ButtonOption[] = [];

    if (showPauseResumeButton) {
      buttonList.push({
        id: 'pause-resume',
        icon: isCallPaused ? (
          <ResumeIcon width={24} height={24} />
        ) : (
          <PauseIcon width={24} height={24} color={colors.white} />
        ),
        label: t(
          `ListeningScreen.${isCallPaused ? 'resumeTranscription' : 'pauseTranscription'}`,
        ),
        onPress: onPauseResumePress,
        disabled: isPauseResumeDisabled,
        variant: isCallPaused ? 'active' : 'default',
      });
    }

    if (showFocusModeButton) {
      buttonList.push({
        id: 'focus',
        icon: <MicIcon color={isFocusMode ? colors.black : colors.white} />,
        label: t(`ListeningScreen.${isFocusMode ? 'focused' : 'focus'}`),
        onPress: onFocusModeButtonPress,
        disabled: false,
        variant: isFocusMode ? 'active' : 'default',
      });
    }

    if (showEndSessionButton) {
      buttonList.push({
        id: 'end',
        icon: <View style={styles.redSquareIcon} />,
        label: t('ListeningScreen.endSession'),
        onPress: onCallEndPress,
        disabled: isCallEndDisabled,
        variant: 'destructive',
      });
    }

    return buttonList;
  }, [
    showPauseResumeButton,
    showFocusModeButton,
    showEndSessionButton,
    isCallPaused,
    isFocusMode,
    onPauseResumePress,
    onFocusModeButtonPress,
    onCallEndPress,
    isPauseResumeDisabled,
    isCallEndDisabled,
    t,
  ]);

  return (
    <View style={styles.container}>
      <CollapsibleButtonGroup
        buttons={buttons}
        isMaximized={isMaximized}
        onToggleMaximized={onToggleMaximized}
        customContainerStyle={styles.sectionContainer}
        testID="listening-control-buttons">
        <View style={styles.securityContainer}>
          <ShieldIcon width={16} height={16} color={colors.lightGrayD9} />
          <Text style={styles.securityText}>
            {t('ListeningScreen.dataSafe')}
          </Text>
        </View>
      </CollapsibleButtonGroup>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
  },
  sectionContainer: {
    backgroundColor: colors.darkGray3,
    borderRadius: '24@ms',
    paddingHorizontal: '21@s',
    minHeight: '44@ms',
  },
  redSquareIcon: {
    width: '16@s',
    height: '16@s',
    backgroundColor: colors.coralRed,
    borderRadius: '2@ms',
  },
  securityText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '12@ms',
    color: colors.white,
    textAlign: 'center',
  },
  securityContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '4@s',
    marginVertical: '18@vs',
    width: '100%',
  },
});

import React, {useMemo} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  CloseIcon,
  MicIcon,
  PauseIcon,
  ResumeIcon,
  ShieldIcon,
} from '@/assets/icons';
import {CollapsibleButtonGroup} from '@/components';
import type {ButtonOption} from '@/components/ButtonGroup';
import {DEFAULT_HIT_SLOP} from '@/constants';
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
  showMuteTooltip?: boolean;
  onDismissMuteTooltip?: () => void;
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
  showMuteTooltip = false,
  onDismissMuteTooltip,
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
          `listeningScreen.${isCallPaused ? 'resumeTranscription' : 'pauseTranscription'}`,
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
        label: t(`listeningScreen.${isFocusMode ? 'focused' : 'focus'}`),
        onPress: onFocusModeButtonPress,
        disabled: false,
        variant: isFocusMode ? 'active' : 'default',
      });
    }

    if (showEndSessionButton) {
      buttonList.push({
        id: 'end',
        icon: <View style={styles.redSquareIcon} />,
        label: t('listeningScreen.endSession'),
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

  const muteTooltipContent = showMuteTooltip ? (
    <View style={styles.tooltipContainer}>
      <View style={styles.tooltip}>
        <Text style={styles.tooltipText}>
          {t('listeningScreen.muteTooltip')}
        </Text>
        <TouchableOpacity
          onPress={onDismissMuteTooltip}
          hitSlop={DEFAULT_HIT_SLOP}>
          <CloseIcon
            width={12}
            height={12}
            color={colors.ds.typography.highEmphasis}
          />
        </TouchableOpacity>
      </View>
      <View style={styles.tooltipArrow} />
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <CollapsibleButtonGroup
        buttons={buttons}
        isMaximized={isMaximized}
        onToggleMaximized={onToggleMaximized}
        customContainerStyle={styles.sectionContainer}
        headerContent={muteTooltipContent}
        testID="listening-control-buttons">
        <View style={styles.securityContainer}>
          <ShieldIcon width={16} height={16} color={colors.lightGrayD9} />
          <Text style={styles.securityText}>
            {t('listeningScreen.dataSafe')}
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
  tooltipContainer: {
    alignSelf: 'flex-start',
    marginLeft: '32@ms',
    marginBottom: '4@vs',
    alignItems: 'flex-start',
  },
  tooltip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
    backgroundColor: colors.white,
    borderRadius: '4@ms',
    paddingHorizontal: '12@ms',
    paddingVertical: '8@vs',
    maxWidth: '300@ms',
  },
  tooltipText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    lineHeight: '18@ms',
    color: colors.ds.typography.highEmphasis,
    flex: 1,
  },
  tooltipArrow: {
    width: 0,
    height: 0,
    marginLeft: '20@ms',
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.white,
  },
});

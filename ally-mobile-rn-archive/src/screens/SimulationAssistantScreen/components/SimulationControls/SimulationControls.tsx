import React, {useMemo} from 'react';
import {View} from 'react-native';

import {
  MicIcon,
  MicOffIcon,
  MicOnIcon,
  PauseWhiteIcon,
  PlayWhiteIcon,
} from '@/assets/icons';
import {CollapsibleButtonGroup} from '@/components';
import type {ButtonOption} from '@/components/ButtonGroup';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {styles} from '../../styles';

interface SimulationControlsProps {
  isMaximized: boolean;
  onToggleMaximized: () => void;
  isMicEnabled: boolean;
  onMicToggle: () => void;
  isFocusMode: boolean;
  onFocusModeToggle: () => void;
  onEndSession: () => void;
  isSimulationInProgress: boolean;
  showFocusButton?: boolean;
  isPaused?: boolean;
  onPauseToggle?: () => void;
}

export const SimulationControls: React.FC<SimulationControlsProps> = ({
  isMaximized,
  onToggleMaximized,
  isMicEnabled,
  onMicToggle,
  isFocusMode,
  onFocusModeToggle,
  onEndSession,
  isSimulationInProgress,
  showFocusButton = true,
  isPaused = false,
  onPauseToggle,
}) => {
  const {t} = useTranslate();

  const controlButtons: ButtonOption[] = useMemo(
    () => [
      {
        id: 'mic',
        icon: !isMicEnabled ? <MicOffIcon /> : <MicOnIcon />,
        label: t(`simulationPage.${!isMicEnabled ? 'unmute' : 'mute'}`),
        onPress: onMicToggle,
        // Pause is a superset of mute — disable mic toggle while paused.
        disabled: !isSimulationInProgress || isPaused,
        variant: !isMicEnabled ? 'active' : 'default',
      },
      ...(showFocusButton
        ? [
            {
              id: 'focus',
              icon: (
                <MicIcon color={isFocusMode ? colors.black : colors.white} />
              ),
              label: t(`listeningScreen.${isFocusMode ? 'focused' : 'focus'}`),
              onPress: onFocusModeToggle,
              disabled: !isSimulationInProgress || isPaused,
              variant: (isFocusMode ? 'active' : 'default') as
                | 'active'
                | 'default',
            },
          ]
        : []),
      ...(onPauseToggle
        ? [
            {
              id: 'pause',
              icon: isPaused ? <PlayWhiteIcon /> : <PauseWhiteIcon />,
              label: t(`simulationPage.${isPaused ? 'resume' : 'pause'}`),
              onPress: onPauseToggle,
              disabled: !isSimulationInProgress,
              variant: (isPaused ? 'active' : 'default') as
                | 'active'
                | 'default',
            },
          ]
        : []),
      {
        id: 'end',
        icon: <View style={styles.endButtonIcon} />,
        label: t('simulationPage.endSession'),
        onPress: onEndSession,
        disabled: !isSimulationInProgress,
        variant: 'destructive',
      },
    ],
    [
      isMicEnabled,
      isFocusMode,
      isSimulationInProgress,
      showFocusButton,
      isPaused,
      onPauseToggle,
      t,
      onMicToggle,
      onFocusModeToggle,
      onEndSession,
    ],
  );

  return (
    <CollapsibleButtonGroup
      buttons={controlButtons}
      isMaximized={isMaximized}
      onToggleMaximized={onToggleMaximized}
      testID="simulation-control-buttons"
    />
  );
};

import React, {useMemo} from 'react';
import {View} from 'react-native';

import {MicIcon, MicOffIcon, MicOnIcon} from '@/assets/icons';
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
}) => {
  const {t} = useTranslate();

  const controlButtons: ButtonOption[] = useMemo(
    () => [
      {
        id: 'mic',
        icon: !isMicEnabled ? <MicOffIcon /> : <MicOnIcon />,
        label: t(`SimulationAssistant.${!isMicEnabled ? 'unmute' : 'mute'}`),
        onPress: onMicToggle,
        disabled: !isSimulationInProgress,
        variant: !isMicEnabled ? 'active' : 'default',
      },
      {
        id: 'focus',
        icon: <MicIcon color={isFocusMode ? colors.black : colors.white} />,
        label: t(`ListeningScreen.${isFocusMode ? 'focused' : 'focus'}`),
        onPress: onFocusModeToggle,
        disabled: !isSimulationInProgress,
        variant: isFocusMode ? 'active' : 'default',
      },
      {
        id: 'end',
        icon: <View style={styles.endButtonIcon} />,
        label: t('SimulationAssistant.endSession'),
        onPress: onEndSession,
        disabled: !isSimulationInProgress,
        variant: 'destructive',
      },
    ],
    [
      isMicEnabled,
      isFocusMode,
      isSimulationInProgress,
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

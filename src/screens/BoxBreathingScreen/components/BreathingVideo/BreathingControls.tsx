// BreathingControls.tsx
import React from 'react';
import {TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  PauseWhiteIcon,
  PlayWhiteIcon,
  VolumeIcon,
  VolumeOffIcon,
} from '@/assets/icons';
import {colors} from '@/theme/colors';

type Props = {
  isMuted: boolean;
  isPlaying: boolean;
  onToggleMute: () => void;
  onTogglePlayPause: () => void;
};

export const BreathingControls: React.FC<Props> = ({
  isMuted,
  isPlaying,
  onToggleMute,
  onTogglePlayPause,
}) => {
  return (
    <View style={styles.controls}>
      <TouchableOpacity onPress={onToggleMute} style={styles.button}>
        {isMuted ? <VolumeOffIcon /> : <VolumeIcon />}
      </TouchableOpacity>
      <TouchableOpacity onPress={onTogglePlayPause} style={styles.button}>
        {isPlaying ? <PauseWhiteIcon /> : <PlayWhiteIcon />}
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  controls: {
    flexDirection: 'row',
    gap: '20@ms',
    marginBottom: '40@mvs',
  },
  button: {
    width: '56@ms',
    height: '56@ms',
    borderRadius: '28@ms',
    backgroundColor: colors.lightGray5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

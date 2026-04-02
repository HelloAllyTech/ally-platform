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
import {colors} from '@/theme';

type Props = {
  isMuted: boolean;
  isPlaying: boolean;
  onToggleMute: () => void;
  onTogglePlayPause: () => void;
  testID?: string;
};

export const BreathingControls: React.FC<Props> = ({
  isMuted,
  isPlaying,
  onToggleMute,
  onTogglePlayPause,
  testID,
}) => {
  return (
    <View style={styles.controls} testID={testID}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onToggleMute}
        style={styles.button}
        testID="volume-button">
        {isMuted ? <VolumeOffIcon /> : <VolumeIcon />}
      </TouchableOpacity>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onTogglePlayPause}
        style={styles.button}
        testID="play-pause-button">
        {isPlaying ? (
          <PauseWhiteIcon />
        ) : (
          <PlayWhiteIcon color={colors.ds.neutral.white} />
        )}
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
    backgroundColor: colors.lightGray6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

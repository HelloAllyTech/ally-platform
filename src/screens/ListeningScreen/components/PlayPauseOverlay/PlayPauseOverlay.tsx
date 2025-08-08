import React from 'react';
import {TouchableOpacity} from 'react-native';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';

import {PauseIcon, PlayIcon} from '@/assets/icons';
import {colors} from '@/theme';

interface PlayPauseOverlayProps {
  isPlaying: boolean;
  onPress: () => void;
  isFocusMode?: boolean;
  isDisabled?: boolean;
}

export const PlayPauseOverlay: React.FC<PlayPauseOverlayProps> = ({
  isPlaying,
  onPress,
  isFocusMode = true,
  isDisabled = false,
}) => {
  const size = isFocusMode ? 40 : 32;
  const iconWidth = isFocusMode ? 16 : 11;
  const iconHeight = isFocusMode ? 17 : 12;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          width: moderateScale(size),
          height: moderateScale(size),
          borderRadius: moderateScale(size / 2),
          backgroundColor: colors.gunmetal,
        },
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}>
      {isPlaying ? (
        <PauseIcon
          width={moderateScale(iconWidth)}
          height={moderateScale(iconHeight)}
          color={colors.lightGray16}
        />
      ) : (
        <PlayIcon
          width={moderateScale(iconWidth)}
          height={moderateScale(iconHeight)}
          color={colors.lightGray16}
        />
      )}
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

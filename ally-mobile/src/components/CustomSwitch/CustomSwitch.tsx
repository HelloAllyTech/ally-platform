import {useEffect, useState} from 'react';
import {TouchableOpacity} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

const THUMB_SIZE = moderateScale(16);
const TRACK_PADDING = moderateScale(1);
const TRACK_WIDTH = moderateScale(32);
const SLIDE_DISTANCE = TRACK_WIDTH - THUMB_SIZE - TRACK_PADDING * 2;

const SPRING_CONFIG = {damping: 15, stiffness: 200};

interface CustomSwitchProps {
  value?: boolean;
  color?: string;
  onToggle: (isEnabled: boolean) => void;
}

export const CustomSwitch = ({value, color, onToggle}: CustomSwitchProps) => {
  const [internalEnabled, setInternalEnabled] = useState<boolean>(false);
  const isEnabled = value ?? internalEnabled;
  const progress = useSharedValue(isEnabled ? 1 : 0);

  useEffect(() => {
    if (value !== undefined) {
      progress.value = withSpring(value ? 1 : 0, SPRING_CONFIG);
    }
  }, [value, progress]);

  const handleToggle = () => {
    const next = !isEnabled;
    if (value === undefined) {
      setInternalEnabled(next);
      progress.value = withSpring(next ? 1 : 0, SPRING_CONFIG);
    }
    onToggle(next);
  };

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.ds.grey[200], color ?? colors.ds.theme.primary],
    ),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{translateX: progress.value * SLIDE_DISTANCE}],
  }));

  return (
    <TouchableOpacity onPress={handleToggle} activeOpacity={1}>
      <Animated.View style={[styles.switchTrack, trackStyle]}>
        <Animated.View style={[styles.switchThumb, thumbStyle]} />
      </Animated.View>
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  switchTrack: {
    width: '32@ms',
    height: '18@ms',
    borderRadius: '9@ms',
    padding: '1@ms',
    justifyContent: 'center',
  },
  switchThumb: {
    width: '16@ms',
    height: '16@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.ds.neutral.white,
  },
});

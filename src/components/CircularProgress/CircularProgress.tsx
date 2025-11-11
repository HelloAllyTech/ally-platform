import React from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import Svg, {Circle} from 'react-native-svg';

import {colors} from '@/theme';

export interface CircularProgressProps {
  /**
   * Progress value from 0 to max
   */
  progress: number;
  /**
   * Maximum value for progress (default: 100)
   */
  max?: number;
  /**
   * Size of the circular progress in pixels (default: 40)
   */
  size?: number;
  /**
   * Stroke width of the progress circle (default: 3)
   */
  strokeWidth?: number;
  /**
   * Color of the progress arc (default: colors.blue)
   */
  progressColor?: string;
  /**
   * Color of the background track (default: colors.lightGray4)
   */
  trackColor?: string;
  /**
   * Optional content to render in the center
   */
  children?: React.ReactNode;
}

/**
 * CircularProgress Component
 *
 * A reusable circular progress indicator using SVG.
 * Displays progress as a partial circle arc with optional center content.
 */
export const CircularProgress: React.FC<CircularProgressProps> = ({
  progress,
  max = 100,
  size = 32,
  strokeWidth = 3,
  progressColor = colors.blue,
  trackColor = colors.ds.grey[100],
  children,
}) => {
  // Calculate the circle properties
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Calculate progress percentage
  const progressPercentage = Math.min(Math.max(progress / max, 0), 1);
  const strokeDashoffset = circumference * (1 - progressPercentage);

  return (
    <View style={[styles.container, {width: size, height: size}]}>
      <Svg width={size} height={size}>
        {/* Background track circle */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress arc - only render if progress > 0 to avoid dot from rounded linecap */}
        {progressPercentage > 0 && (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={progressColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            rotation="-90"
            origin={`${center}, ${center}`}
          />
        )}
      </Svg>
      {children && <View style={styles.childrenContainer}>{children}</View>}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  childrenContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

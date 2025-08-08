import React from 'react';
import {Dimensions, StyleSheet, View} from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, {Defs, LinearGradient, Path, Rect, Stop} from 'react-native-svg';

import {colors as globalColors} from '@/theme';

const DEFAULT_WAVE_CONFIGS = [
  {
    amplitude: 30,
    frequency: 1,
    opacity: 0.05,
    echoCount: 2,
    colors: {
      start: '#FF6B6B',
      middle: '#FF8E8E',
      end: '#FF6B6B',
    },
  },
  {
    amplitude: 50,
    frequency: 1.2,
    opacity: 0.1,
    echoCount: 2,
    colors: {
      start: '#4ECDC4',
      middle: '#6ED7D0',
      end: '#4ECDC4',
    },
  },
  {
    amplitude: 70,
    frequency: 1.4,
    opacity: 0.15,
    echoCount: 3,
    colors: {
      start: '#45B7D1',
      middle: '#6BC8E0',
      end: '#45B7D1',
    },
  },
  {
    amplitude: 90,
    frequency: 1.6,
    opacity: 0.2,
    echoCount: 3,
    colors: {
      start: '#96CEB4',
      middle: '#B4E0C4',
      end: '#96CEB4',
    },
  },
  {
    amplitude: 110,
    frequency: 1.8,
    opacity: 0.25,
    echoCount: 4,
    colors: {
      start: '#FFEEAD',
      middle: '#FFF4C9',
      end: '#FFEEAD',
    },
  },
];

const {width: SCREEN_WIDTH, height: SCREEN_HEIGHT} = Dimensions.get('window');
const AnimatedPath = Animated.createAnimatedComponent(Path);

interface WaveProps {
  amplitude: number;
  frequency: number;
  opacity: number;
  echoCount?: number;
  colors: {
    start: string;
    middle: string;
    end: string;
  };
  isAnimating?: boolean;
}

interface EchoWaveProps {
  index: number;
  frequency: number;
  amplitude: number;
  isAnimating?: boolean;
}

const EchoWave: React.FC<EchoWaveProps> = ({
  index,
  frequency,
  amplitude,
  isAnimating = true,
}) => {
  const echoRandomSpeed = React.useMemo(() => 3000 + Math.random() * 2000, []);
  const echoRandomPhase = React.useMemo(() => Math.random() * Math.PI * 2, []);
  const echoPhase = useSharedValue(echoRandomPhase);
  const echoScale = 1 - index * 0.1;

  React.useEffect(() => {
    if (isAnimating) {
      echoPhase.value = withRepeat(
        withTiming(echoPhase.value + Math.PI * 2, {
          duration: echoRandomSpeed,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    }
  }, [isAnimating, echoPhase, echoRandomSpeed]);

  const animatedProps = useAnimatedProps(() => {
    'worklet';
    const points: {x: number; y: number}[] = [];
    const numPoints = 100;
    const centerY = SCREEN_HEIGHT / 2;
    const startX = 0;
    const endX = SCREEN_WIDTH;

    for (let i = 0; i <= numPoints; i++) {
      const percent = i / numPoints;
      const edgeFade = Math.pow(Math.sin(percent * Math.PI), 2);
      const x = startX + (endX - startX) * percent;
      const y =
        centerY +
        Math.sin(echoPhase.value + frequency * percent * Math.PI * 2) *
          amplitude *
          edgeFade *
          echoScale;
      points.push({x, y});
    }

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 2; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      path += ` Q ${points[i].x} ${points[i].y}, ${xc} ${yc}`;
    }
    return {d: path};
  });

  return (
    <AnimatedPath
      animatedProps={animatedProps}
      stroke={globalColors.lightGraySubtle}
      strokeWidth={2}
      fill="none"
    />
  );
};

const Wave: React.FC<WaveProps> = ({
  amplitude,
  frequency,
  opacity,
  echoCount = 1,
  colors,
  isAnimating = true,
}) => {
  const randomSpeed = React.useMemo(() => 3000 + Math.random() * 2000, []);
  const randomPhase = React.useMemo(() => Math.random() * Math.PI * 2, []);
  const phase = useSharedValue(randomPhase);

  React.useEffect(() => {
    if (isAnimating) {
      phase.value = withRepeat(
        withTiming(phase.value + Math.PI * 2, {
          duration: randomSpeed,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    }
  }, [isAnimating, phase, randomSpeed]);

  return (
    <Svg height={SCREEN_HEIGHT} width={SCREEN_WIDTH}>
      <Defs>
        <LinearGradient id={`grad-${colors.start}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={colors.start} stopOpacity="0" />
          <Stop offset="0.1" stopColor={colors.middle} stopOpacity={opacity} />
          <Stop offset="0.9" stopColor={colors.middle} stopOpacity={opacity} />
          <Stop offset="1" stopColor={colors.end} stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id="grad-center-line" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#fff" stopOpacity="0" />
          <Stop offset="0.8" stopColor="#fff" stopOpacity="0.8" />
          <Stop offset="0.2" stopColor="#fff" stopOpacity="0.8" />
          <Stop offset="1" stopColor="#fff" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect
        x={0}
        y={SCREEN_HEIGHT / 2 - 3}
        width={SCREEN_WIDTH}
        height={1}
        fill={globalColors.semiTransparentGray}
      />
      {Array.from({length: echoCount}).map((_, index) => (
        <EchoWave
          key={index}
          index={index}
          frequency={frequency}
          amplitude={amplitude}
          isAnimating={isAnimating}
        />
      ))}
    </Svg>
  );
};

interface ListeningAnimationProps {
  isAnimating?: boolean;
  maxAmplitude?: number;
}

export const ListeningAnimation: React.FC<ListeningAnimationProps> = ({
  isAnimating = true,
  maxAmplitude = 110,
}) => {
  const waveConfigs = React.useMemo(() => {
    const amplitudeScale = maxAmplitude / 110;
    return DEFAULT_WAVE_CONFIGS.map(config => ({
      ...config,
      amplitude: config.amplitude * amplitudeScale,
    }));
  }, [maxAmplitude]);

  return (
    <View style={styles.container}>
      <View style={styles.waveContainer}>
        {waveConfigs.map((config, index) => (
          <Wave key={index} {...config} isAnimating={isAnimating} />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  waveContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

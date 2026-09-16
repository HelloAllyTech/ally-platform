import {useMemo} from 'react';
import {View} from 'react-native';
import Animated, {useAnimatedProps} from 'react-native-reanimated';
import Svg, {
  Defs,
  Path,
  PathProps,
  RadialGradient,
  Stop,
} from 'react-native-svg';

interface FlowerPetalProps {
  // Reanimated shared value between 0 and 1
  bloomProgress: {value: number};
  size?: number;
}

export const FlowerPetal = ({bloomProgress, size = 350}: FlowerPetalProps) => {
  const centerX = size / 2;
  const centerY = size / 2;
  const angles = useMemo(() => [0, -65, -35, 65, 35], []);
  const AnimatedPath = useMemo(
    () => Animated.createAnimatedComponent(Path),
    [],
  );

  // Create animated props for each petal path, fully on UI thread
  const usePetalAnimatedProps = (angle: number) =>
    useAnimatedProps(() => {
      'worklet';
      const progress = bloomProgress.value;
      const radians = (angle * progress * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);

      const transform = (x: number, y: number) => {
        'worklet';
        const newX = x * cos - y * sin + centerX;
        const newY = x * sin + y * cos + centerY;
        return `${newX},${newY}`;
      };

      const d = `M ${centerX},${centerY}
        C ${transform(-35, -40)} ${transform(-35, -100)} ${transform(0, -140)}
        C ${transform(35, -100)} ${transform(35, -40)} ${centerX},${centerY}
        Z`;
      const opacity = 0.2 + Math.min(progress, 0.6);
      return {d, opacity} as Partial<PathProps>;
    });

  // Create stem path
  const stemPath = `
    M ${centerX - 20},${centerY + 20}
    A  20,20 0 0,0 ${centerX + 20},${centerY + 20}
    Z
  `;

  return (
    <View style={{width: size, height: size}}>
      <Svg width={size} height={size * 1.5} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <RadialGradient id="petalGradient" cx="50%" cy="20%" r="80%">
            <Stop offset="0%" stopColor="rgba(255, 255, 255, 0.2)" />
            <Stop offset="100%" stopColor="#BBBBBB" />
          </RadialGradient>
        </Defs>

        {/* Render petals */}
        {angles.map((angle, index) => {
          // eslint-disable-next-line react-hooks/rules-of-hooks
          const animatedProps = usePetalAnimatedProps(angle);
          return (
            <AnimatedPath
              key={index}
              animatedProps={animatedProps}
              fill="url(#petalGradient)"
              stroke="rgba(0,0,0,0.3)"
              strokeWidth="0.5"
            />
          );
        })}

        {/* Render stem */}
        <Path
          d={stemPath}
          fill="rgb(197, 197, 197)"
          transform={`rotate(180 ${centerX} ${centerY + 15})`}
        />
      </Svg>
    </View>
  );
};

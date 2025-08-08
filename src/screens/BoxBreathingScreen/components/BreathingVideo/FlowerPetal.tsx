import {View} from 'react-native';
import Svg, {Defs, Path, RadialGradient, Stop} from 'react-native-svg';

interface FlowerPetalProps {
  bloomProgress: number;
  size?: number;
}

export const FlowerPetal = ({bloomProgress, size = 350}: FlowerPetalProps) => {
  const centerX = size / 2;
  const centerY = size / 2;
  const angles = [0, -65, -35, 65, 35];

  // Create petal path using bezier curves
  const createPetalPath = (angle: number) => {
    const radians = (angle * bloomProgress * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    // Transform coordinates for rotation
    const transform = (x: number, y: number) => {
      const newX = x * cos - y * sin + centerX;
      const newY = x * sin + y * cos + centerY;
      return `${newX},${newY}`;
    };

    return `
      M ${centerX},${centerY}
      C ${transform(-35, -40)} ${transform(-35, -100)} ${transform(0, -140)}
      C ${transform(35, -100)} ${transform(35, -40)} ${centerX},${centerY}
      Z
    `;
  };

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
        {angles.map((angle, index) => (
          <Path
            key={index}
            d={createPetalPath(angle)}
            fill="url(#petalGradient)"
            stroke="rgba(0,0,0,0.3)"
            strokeWidth="0.5"
            opacity={0.2 + Math.min(bloomProgress, 0.6)}
          />
        ))}

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

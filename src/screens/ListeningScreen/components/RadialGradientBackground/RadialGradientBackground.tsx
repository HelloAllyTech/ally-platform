import Svg, {Defs, RadialGradient, Rect, Stop} from 'react-native-svg';

import {SCREEN_WIDTH} from '@/constants/general';
import {colors} from '@/theme/colors';

const width = SCREEN_WIDTH;

export const RadialGradientBackground = () => (
  <Svg width={width} height={width}>
    <Defs>
      <RadialGradient
        id="grad"
        cx="50%"
        cy="60%"
        rx="60%"
        ry="60%"
        fx="50%"
        fy="50%">
        <Stop offset="0%" stopColor={colors.oceanBlue} stopOpacity="1" />
        <Stop offset="100%" stopColor={colors.black} stopOpacity="1" />
      </RadialGradient>
    </Defs>
    <Rect x="0" y="0" width={width} height={width} fill="url(#grad)" />
  </Svg>
);

export default RadialGradientBackground;

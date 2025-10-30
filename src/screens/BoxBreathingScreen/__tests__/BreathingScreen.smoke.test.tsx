import React from 'react';
import {render} from '@testing-library/react-native';

import {BreathingScreen} from '../BreathingScreen';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
  useHardwareBackPressHandler: () => undefined,
}));

jest.mock('@/assets', () => ({breathingBackground: 1}));

jest.mock('@/store/hooks', () => ({useAppDispatch: () => jest.fn()}));

jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('lottie-react-native', () => 'LottieView');

jest.mock('../components/CallEndOverlay/CallEndOverlay', () => ({
  CallEndOverlay: () => null,
}));

jest.mock('../components/BreathingVideo/BoxBreathingAnimation', () => ({
  BoxBreathingAnimation: () => null,
}));

jest.mock('../components/BreathingVideo/BreathingControls', () => ({
  BreathingControls: () => null,
}));

jest.mock('@/components', () => ({
  PrimaryButton: () => null,
}));

describe('BreathingScreen smoke', () => {
  it('renders without crashing', () => {
    const navigation: any = {navigate: jest.fn(), reset: jest.fn()};
    render(
      <BreathingScreen navigation={navigation} route={{} as any} />,
    );
  });
});



// BoxBreathingLottie.tsx
import {forwardRef} from 'react';
import LottieView from 'lottie-react-native';
import {StyleSheet} from 'react-native';

const BoxBreathingLottie = forwardRef<LottieView>((props, ref) => {
  return (
    <LottieView
      ref={ref}
      source={require('@/assets/animations/flower.json')}
      style={styles.lottie}
      loop
    />
  );
});

const styles = StyleSheet.create({
  lottie: {
    width: '100%',
    height: '50%',
  },
});

export default BoxBreathingLottie;

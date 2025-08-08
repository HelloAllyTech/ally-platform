import {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {isIOS} from '@/constants/general';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

export const CallEndOverlay = () => {
  const [messageIndex, setMessageIndex] = useState(0);
  const opacity = useSharedValue(1);
  const {t} = useTranslate();

  useEffect(() => {
    const timer = setTimeout(() => {
      // Fade out text
      opacity.value = withTiming(0, {duration: 500});

      // After fade out completes, switch message and fade in
      setTimeout(() => {
        setMessageIndex(1);
        opacity.value = withTiming(1, {duration: 500});
      }, 500); // Wait until fade-out completes
    }, 1000);

    return () => clearTimeout(timer);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <LinearGradient
      colors={[colors.black, colors.darkBlue3]}
      style={styles.container}>
      <View style={styles.content}>
        <Animated.View style={animatedStyle}>
          {messageIndex === 0 ? (
            <Text style={styles.text}>
              {t('BreathingScreen.youGaveYour')}{' '}
              <Text style={styles.italic}>{t('BreathingScreen.best')}</Text>
              {'\n'}
              {t('BreathingScreen.onThatCall')}
            </Text>
          ) : (
            <Text style={styles.text}>
              {t('BreathingScreen.nowTakeAMoment')}
              {'\n'}
              <Text>{t('BreathingScreen.for')}</Text>{' '}
              <Text style={styles.italic}>{t('BreathingScreen.yourself')}</Text>
            </Text>
          )}
        </Animated.View>
      </View>
    </LinearGradient>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '24@ms',
  },
  text: {
    color: colors.white,
    fontSize: '32@ms',
    textAlign: 'center',
    lineHeight: '34@mvs',
    ...fontFamily.REPLAY_PRO.HEADLINE,
  },
  italic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
  },
});

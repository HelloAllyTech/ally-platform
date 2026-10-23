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
import {colors, fontFamily} from '@/theme';

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
        <Animated.View
          style={[styles.block, animatedStyle]}
          testID="animated-message">
          {messageIndex === 0 ? (
            <View style={styles.lineWrap}>
              {/* Line 1: text + pill */}
              <View style={styles.inlineRow}>
                <Text style={styles.text}>
                  {t('stressBuster.messages.gaveBest')}{' '}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.lineWrap}>
              <Text style={styles.text}>
                {t('stressBuster.messages.momentForYourself')}
              </Text>
            </View>
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
  block: {
    width: '100%',
  },
  lineWrap: {
    alignItems: 'center',
  },
  inlineRow: {
    flexDirection: 'row',
  },
  text: {
    color: colors.white,
    fontSize: '32@ms',
    textAlign: 'center',
    lineHeight: '42@mvs',
    ...fontFamily.REPLAY_PRO.HEADLINE,
  },
  pill: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
    backgroundColor: colors.brightBlue,
    paddingHorizontal: '12@s',
    paddingTop: '4@vs',
    paddingBottom: '1@vs',
    borderRadius: '40@s',
    overflow: 'hidden',
    includeFontPadding: false,
    textAlign: 'center',
  },
});

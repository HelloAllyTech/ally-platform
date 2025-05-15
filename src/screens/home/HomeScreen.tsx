import LottieView from 'lottie-react-native';
import React, {useCallback, useEffect} from 'react';
import {BackHandler, Text, TouchableOpacity, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import {HeadphoneIcon, InfoIcon} from '@/assets/icons';
import {DEFAULT_HIT_SLOP} from '@/constants/general';
import {useCounselorChat} from '@/hooks/useCounselorChat';
import useTranslate from '@/hooks/useTranslate';
import type {RootStackScreenProps} from '@/navigation/types';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

export const HomeScreen: React.FC<RootStackScreenProps<'Home'>> = ({
  navigation,
}) => {
  const {t} = useTranslate();

  useCounselorChat();

  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        BackHandler.exitApp();
        return true;
      },
    );

    return () => backHandler.remove();
  }, []);

  const handleListeningPress = useCallback(() => {
    navigation.navigate('Listening');
  }, [navigation]);

  return (
    <LinearGradient
      colors={[colors.black, colors.navyGray, colors.oceanBlue]}
      style={styles.container}
      locations={[0, 0.65, 0.9]}
      start={{x: 0.4, y: 0}}
      end={{x: 0.6, y: 1}}>
      <View style={styles.content}>
        <Text style={styles.titleContainer}>
          <Text style={styles.startText}>{t('HomeScreen.start')} </Text>
          <Text style={styles.listeningText}>{t('HomeScreen.listening')}</Text>
        </Text>

        <TouchableOpacity
          style={styles.animationContainer}
          onPress={handleListeningPress}
          activeOpacity={0.8}>
          <LottieView
            source={require('@/assets/animations/listen.json')}
            autoPlay
            loop
            style={styles.lottieAnimation}
          />
          <View style={styles.headphoneContainer}>
            <HeadphoneIcon width={31} height={31} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleListeningPress}
          style={styles.footer}
          hitSlop={DEFAULT_HIT_SLOP}
          activeOpacity={0.8}>
          <Text style={styles.tapText}>{t('HomeScreen.tapToBegin')}</Text>
          <InfoIcon width={20} height={20} />
        </TouchableOpacity>
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
    alignItems: 'center',
    paddingTop: '150@vs',
    paddingBottom: '80@vs',
  },
  titleContainer: {
    textAlign: 'center',
    marginBottom: '71@vs',
  },
  startText: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.white,
    fontSize: '32@ms',
    lineHeight: '40@ms',
  },
  listeningText: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: 'italic',
    color: colors.white,
    fontSize: '32@ms',
    lineHeight: '40@ms',
  },
  animationContainer: {
    width: '180@ms',
    height: '180@ms',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '40@vs',
  },
  lottieAnimation: {
    width: '100%',
    height: '100%',
  },
  headphoneContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8@s',
  },
  tapText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.large,
    letterSpacing: 0.15,
    color: colors.mediumGray,
    fontSize: '16@ms',
  },
});

import React, {useCallback} from 'react';
import LottieView from 'lottie-react-native';
import {
  Alert,
  BackHandler,
  Linking,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {HeadphoneIcon} from '@/assets/icons';
import {env} from '@/config/env';
import {DEFAULT_HIT_SLOP, isIOS} from '@/constants/general';
import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';
import {UserRole} from '@/types/user';
import {logger} from '@/utils/logger';

export const HomeScreen: React.FC = () => {
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const {userData} = useUser();

  // Use the custom hook for back press handling
  useHardwareBackPressHandler(() => {
    BackHandler.exitApp();
    return true;
  });

  const handleListeningPress = useCallback(() => {
    Alert.alert(
      t('Common.comingSoon'),
      t('Home.callConnectionNotImplemented'),
      [{text: t('Common.ok')}],
    );
  }, [t]);

  const handleLearnMorePress = useCallback(async () => {
    try {
      const supported = await Linking.canOpenURL(env.ALLY_WEB_URL);
      if (supported) {
        await Linking.openURL(env.ALLY_WEB_URL);
      } else {
        Alert.alert('Error', 'Unable to open the link');
      }
    } catch (error) {
      logger.error(`Error opening learn more URL: ${error}`);
      Alert.alert('Error', 'Unable to open the link');
    }
  }, []);

  // Automatically manages socket connection based on screen focus and app state

  if (userData?.role !== UserRole.COUNSELOR) {
    return (
      <View style={styles.clientContainer}>
        <Text style={styles.oopsText}>{t('Home.client.oops')}</Text>
        <View style={styles.messageContainer}>
          <Text style={styles.messageText}>
            {t('Home.client.appCurrentlyFor')}
          </Text>
          <Text style={styles.messageText}>
            {t('Home.client.counselorsOnly')}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleLearnMorePress}
          style={styles.learnMoreButton}
          hitSlop={DEFAULT_HIT_SLOP}>
          <Text style={styles.learnMoreText}>{t('Home.client.learnMore')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.content}>
      <StatusBar barStyle="light-content" />
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
    </View>
  );
};

const styles = ScaledSheet.create({
  content: {
    flex: 1,
    backgroundColor: colors.white,
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
    color: colors.black,
    fontSize: '32@ms',
    lineHeight: '40@ms',
  },
  listeningText: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
    color: colors.black,
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
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    letterSpacing: 0.15,
    color: colors.mediumGray,
    fontSize: '16@ms',
  },
  clientContainer: {
    flex: 1,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '40@s',
  },
  oopsText: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    color: colors.black,
    fontSize: '48@ms',
    lineHeight: '56@ms',
    textAlign: 'center',
    marginBottom: '30@mvs',
    fontStyle: isIOS ? 'italic' : 'normal',
  },
  messageContainer: {
    marginBottom: '30@mvs',
    alignItems: 'center',
  },
  messageText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.mediumGray,
    fontSize: '18@ms',
    lineHeight: '24@ms',
    textAlign: 'center',
  },
  learnMoreButton: {
    paddingVertical: '8@mvs',
    paddingHorizontal: '24@ms',
  },
  learnMoreText: {
    ...fontFamily.ROBOTO.REGULAR,
    color: colors.brightBlue,
    fontSize: '16@ms',
    lineHeight: '20@ms',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});

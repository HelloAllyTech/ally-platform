import React from 'react';
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

import {DrawerMenuIcon, HeadphoneIcon} from '@/assets/icons';
import {env} from '@/config/env';
import {isIOS} from '@/constants/general';
import {useDrawerNavigation} from '@/hooks/useDrawerNavigation';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';
import {UserRole} from '@/types/user';

import {FeatureNotAvailable} from './components/FeatureNotAvailable/FeatureNotAvailable';

export const HomeScreen: React.FC = () => {
  const {t} = useTranslate();
  const drawerNavigation = useDrawerNavigation();
  const {userData} = useUser();

  // Use the custom hook for back press handling
  useHardwareBackPressHandler(() => {
    BackHandler.exitApp();
    return true;
  });

  const handleThirdPartyCall = async () => {
    const url = `tel:${env.THIRD_PARTY_CALL_NUMBER}`;
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Error', "Can't handle phone call", [{text: t('Common.ok')}]);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <TouchableOpacity
        style={styles.headerContainer}
        onPress={() => drawerNavigation.openDrawer()}>
        <DrawerMenuIcon />
      </TouchableOpacity>
      {userData?.role !== UserRole.COUNSELOR ? (
        <FeatureNotAvailable />
      ) : (
        <View style={styles.content}>
          <Text style={styles.titleContainer}>
            <Text style={styles.startText}>{t('HomeScreen.start')} </Text>
            <Text style={styles.listeningText}>
              {t('HomeScreen.listening')}
            </Text>
          </Text>

          <TouchableOpacity
            style={styles.animationContainer}
            onPress={handleThirdPartyCall}
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
            onPress={handleThirdPartyCall}
            activeOpacity={0.8}
            style={styles.textContainer}>
            <Text style={styles.tapText}>{t('HomeScreen.tapToBegin')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    paddingTop: '50@mvs',
  },
  headerContainer: {
    paddingHorizontal: '20@ms',
    paddingVertical: '10@mvs',
    alignSelf: 'flex-start',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingTop: '80@vs',
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
    color: colors.darkCharcoal,
    fontSize: '16@ms',
  },
  textContainer: {
    width: '100%',
    paddingVertical: '16@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

import React, {useCallback, useEffect} from 'react';
import {
  Alert,
  BackHandler,
  Linking,
  Platform,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {PERMISSIONS, RESULTS} from 'react-native-permissions';
import {ScaledSheet} from 'react-native-size-matters';

import {DrawerMenuIcon} from '@/assets/icons';
import images from '@/assets/images';
import {env} from '@/config/env';
import {DEFAULT_HIT_SLOP, isIOS} from '@/constants/general';
import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useDrawerNavigation} from '@/hooks/useDrawerNavigation';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import {usePermission} from '@/hooks/usePermission';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {useGetSummaryFieldsQuery} from '@/services/settingsApi';
import {useAppDispatch} from '@/store/hooks';
import {setSummaryVisibleFields} from '@/store/slices/summarySlice';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';
import {UserRole} from '@/types/user';
import {logger} from '@/utils/logger';

import {FeatureNotAvailable} from './components/FeatureNotAvailable/FeatureNotAvailable';
import StartCallCard from './components/StartCallCard/StartCallCard';

export const HomeScreen: React.FC = () => {
  const {t} = useTranslate();
  const drawerNavigation = useDrawerNavigation();
  const navigation = useAppNavigation();
  const {userData} = useUser();
  const dispatch = useAppDispatch();
  const {data: visibleFields} = useGetSummaryFieldsQuery();

  // Use the custom hook for back press handling
  useHardwareBackPressHandler(() => {
    BackHandler.exitApp();
    return true;
  });

  useEffect(() => {
    if (visibleFields) {
      dispatch(setSummaryVisibleFields(visibleFields));
    }
  }, [visibleFields, dispatch]);

  const micPermission = Platform.select({
    ios: PERMISSIONS.IOS.MICROPHONE,
    android: PERMISSIONS.ANDROID.RECORD_AUDIO,
  });

  const {
    requestPermission: requestMicPermission,
    openAppSettings,
    isGranted: isMicGranted,
  } = usePermission(micPermission!);

  const handleThirdPartyCall = async () => {
    const url = `tel:${env.THIRD_PARTY_CALL_NUMBER}`;
    try {
      await Linking.openURL(url);
    } catch (error) {
      logger.error(`Error opening phone call URL: ${error}`);
      Alert.alert('Error', "Can't handle phone call", [{text: t('Common.ok')}]);
    }
  };

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

  const handleVoiceRecording = async () => {
    if (isMicGranted) {
      navigation.navigate('Listening', {isRecording: true});
      return;
    }
    const result = await requestMicPermission();
    if (result === RESULTS.GRANTED) {
      navigation.navigate('Listening', {isRecording: true});
    } else {
      Alert.alert(
        'Microphone Permission Required',
        'Please enable microphone access in your device settings to use voice recording.',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Open Settings', onPress: openAppSettings},
        ],
      );
    }
  };

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
          <Text style={styles.title}>{t('Home.start')}</Text>
          <Text style={styles.subtitle}>{t('Home.session')}</Text>
          <Text style={styles.chooseListening}>
            {t('Home.chooseListening')}
          </Text>
          <View style={styles.buttonContainer}>
            <StartCallCard
              image={images.joinCall}
              header={t('Home.joinCall')}
              subtitle={t('Home.allyWillJoinOngoingCall')}
              onPressCard={handleThirdPartyCall}
            />
            <StartCallCard
              image={images.listenLive}
              header={t('Home.listenLive')}
              subtitle={t('Home.allyWillHearAudio')}
              onPressCard={handleVoiceRecording}
            />
          </View>
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
    paddingHorizontal: '32@ms',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '56@ms',
    lineHeight: '64@mvs',
  },
  subtitle: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
    color: colors.darkGray12,
    fontSize: '56@ms',
    lineHeight: '64@mvs',
    marginTop: '8@mvs',
  },
  chooseListening: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.charcoal2,
    fontSize: '16@ms',
    lineHeight: '24@mvs',
    marginTop: '8@mvs',
  },
  headerContainer: {
    paddingVertical: '10@mvs',
    alignSelf: 'flex-start',
  },
  content: {
    flex: 1,
    paddingTop: '60@mvs',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupContainer: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    padding: '16@ms',
    width: '80%',
    maxWidth: '300@ms',
  },
  popupOption: {
    paddingVertical: '12@ms',
    paddingHorizontal: '16@ms',
  },
  popupOptionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    color: colors.darkCharcoal,
  },
  clientContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  oopsText: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
  },
  messageContainer: {
    marginBottom: '20@vs',
  },
  messageText: {
    ...fontFamily.REPLAY_PRO.BOLD,
    fontSize: '16@ms',
    color: colors.darkCharcoal,
  },
  learnMoreButton: {
    paddingHorizontal: '20@ms',
    paddingVertical: '10@mvs',
  },
  learnMoreText: {
    ...fontFamily.REPLAY_PRO.BOLD,
    fontSize: '16@ms',
    color: colors.darkCharcoal,
  },
});

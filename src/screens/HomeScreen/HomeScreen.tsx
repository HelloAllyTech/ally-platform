import React, {useEffect} from 'react';
import {
  Alert,
  BackHandler,
  Linking,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {DrawerMenuIcon} from '@/assets/icons';
import images from '@/assets/images';
import {env} from '@/config/env';
import {isIOS} from '@/constants/general';
import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useDrawerNavigation} from '@/hooks/useDrawerNavigation';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {useGetSummaryFieldsQuery} from '@/services/settingsApi';
import {useAppDispatch} from '@/store/hooks';
import {setSummaryVisibleFields} from '@/store/slices/summarySlice';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
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

  const handleThirdPartyCall = async () => {
    const url = `tel:${env.THIRD_PARTY_CALL_NUMBER}`;
    try {
      await Linking.openURL(url);
    } catch (error) {
      logger.error(`Error opening phone call URL: ${error}`);
      Alert.alert('Error', "Can't handle phone call", [{text: t('Common.ok')}]);
    }
  };

  const handleVoiceRecording = async () => {
    navigation.navigate('Listening', {isMicrophoneMode: true});
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
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces={false}>
          <Text style={styles.title}>{t('Home.start')}</Text>
          <Text style={styles.subtitle}>{t('Home.session')}</Text>
          <Text style={styles.chooseListening}>
            {t('Home.chooseListening')}
          </Text>
          <View style={styles.buttonContainerWrapper}>
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
            <Text style={styles.consentNotice}>{t('Home.consentNotice')}</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    paddingTop: '50@ms',
    paddingHorizontal: '32@ms',
  },
  buttonContainerWrapper: {
    marginTop: '45@vs',
    borderWidth: '0.5@ms',
    borderColor: colors.darkGray13,
    borderRadius: '6@ms',
    padding: '8@ms',
    paddingBottom: 0,
    backgroundColor: colors.lightGray1,
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
  scrollView: {
    flex: 1,
  },
  content: {
    paddingTop: '60@mvs',
    paddingBottom: '80@vs',
  },
  consentNotice: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray16,
    fontSize: '12@ms',
    marginTop: '10@mvs',
    marginBottom: '13@mvs',
  },
});

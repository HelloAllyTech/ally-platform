import React, {useCallback, useEffect} from 'react';
import {
  ActivityIndicator, // <-- Add this import
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
import {CHAT_TYPES, isIOS} from '@/constants';
import {
  useAppNavigation,
  useCounselorChat,
  useDrawerNavigation,
  useHardwareBackPressHandler,
  useTranslate,
  useUser,
} from '@/hooks';
import {
  useGetSummaryFieldsQuery,
  useGetVisibleChatTypesQuery,
} from '@/services/settingsApi';
import {useAppDispatch} from '@/store/hooks';
import {setSummaryVisibleFields} from '@/store/slices/summarySlice';
import {colors, fontFamily} from '@/theme';
import {Chat, UserRole} from '@/types';
import {logger} from '@/utils/logger';

import {FeatureNotAvailable, StartCallCard} from './components';

export const HomeScreen: React.FC = () => {
  const {t} = useTranslate();
  const drawerNavigation = useDrawerNavigation();
  const navigation = useAppNavigation();
  const {userData} = useUser();
  const dispatch = useAppDispatch();
  const {data: visibleFields} = useGetSummaryFieldsQuery();
  const {
    data: enabledChatTypes,
    isLoading: isLoadingChatTypes,
    isError: isErrorChatTypes,
  } = useGetVisibleChatTypesQuery();

  const {checkCounselorChat} = useCounselorChat();

  const visibleChatTypes = [
    CHAT_TYPES.EXOTEL_CONFERENCE_CHAT,
    CHAT_TYPES.MICROPHONE_CHAT,
  ].filter(type => enabledChatTypes?.includes(type));

  const isSingleCallType = visibleChatTypes.length === 1;

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
    checkCounselorChat().then(data => {
      const url = `tel:${env.THIRD_PARTY_CALL_NUMBER}`;
      if ((data as Chat)?.chatId) {
        Alert.alert(
          'Already in a call',
          'You are already in a call. Please end the current call to make a new one.',
          [{text: t('Common.ok')}],
        );
        return;
      }
      try {
        Linking.openURL(url);
      } catch (error) {
        logger.error(`Error opening phone call URL: ${error}`);
        Alert.alert('Error', "Can't handle phone call", [
          {text: t('Common.ok')},
        ]);
      }
    });
  };

  const handleVoiceRecording = async () => {
    checkCounselorChat();
    navigation.navigate('Listening', {isMicrophoneMode: true});
  };

  const handleLearnMorePress = useCallback(async () => {
    try {
      await Linking.openURL(env.ALLY_WEB_URL);
    } catch (error) {
      logger.error(`Error opening learn more URL: ${error}`);
      Alert.alert('Error', 'Unable to open the link');
    }
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <TouchableOpacity
        style={styles.headerContainer}
        onPress={() => drawerNavigation.openDrawer()}>
        <DrawerMenuIcon />
      </TouchableOpacity>
      {userData?.role !== UserRole.COUNSELOR ? (
        <FeatureNotAvailable
          description={t('Home.client.appCurrentlyForCounsellors')}
          ctaText={t('Home.client.learnMore')}
          onCtaPress={handleLearnMorePress}
        />
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces={false}>
          {isLoadingChatTypes ? (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="large" />
            </View>
          ) : !visibleChatTypes?.length ? (
            <FeatureNotAvailable
              description={t('HomeScreen.noAccessToCallFeatures')}
              containerStyle={styles.noAccessToCallFeaturesContainer}
            />
          ) : (
            <>
              <Text style={styles.title}>{t('Home.start')}</Text>
              <Text style={styles.subtitle}>{t('Home.session')}</Text>
              <Text style={styles.chooseListening}>
                {t('Home.chooseListening')}
              </Text>
              <View style={styles.buttonContainerWrapper}>
                <View style={styles.buttonContainer}>
                  {!isLoadingChatTypes && !isErrorChatTypes && (
                    <>
                      {visibleChatTypes.includes(
                        CHAT_TYPES.EXOTEL_CONFERENCE_CHAT,
                      ) && (
                        <StartCallCard
                          image={images.joinCall}
                          header={t('Home.joinCall')}
                          subtitle={t('Home.allyWillJoinOngoingCall')}
                          onPressCard={handleThirdPartyCall}
                          customStyles={
                            isSingleCallType ? styles.stretchCard : {}
                          }
                        />
                      )}
                      {visibleChatTypes.includes(
                        CHAT_TYPES.MICROPHONE_CHAT,
                      ) && (
                        <StartCallCard
                          image={images.listenLive}
                          header={t('Home.listenLive')}
                          subtitle={t('Home.allyWillHearAudio')}
                          onPressCard={handleVoiceRecording}
                          customStyles={
                            isSingleCallType ? styles.stretchCard : {}
                          }
                        />
                      )}
                    </>
                  )}
                </View>
                <Text style={styles.consentNotice}>
                  {t('Home.consentNotice')}
                </Text>
              </View>
            </>
          )}
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
    paddingBottom: '80@vs',
    justifyContent: 'center',
    height: '100%',
  },
  consentNotice: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray16,
    fontSize: '12@ms',
    marginTop: '10@mvs',
    marginBottom: '13@mvs',
  },
  stretchCard: {
    flex: 1,
  },
  noAccessToCallFeaturesContainer: {
    paddingHorizontal: '5@s',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

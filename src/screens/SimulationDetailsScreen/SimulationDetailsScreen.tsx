import React, {useState} from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets';
import {
  EmailInputModal,
  OtpModal,
  PrimaryButton,
  useErrorToast,
} from '@/components';
import {AsyncStorageKeys, SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useTranslate} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {useCreateRoomMutation} from '@/services';
import {colors, fontFamily} from '@/theme';
import {getItem} from '@/utils';

type Props = RootStackScreenProps<'SimulationDetails'>;

export const SimulationDetailsScreen: React.FC<Props> = ({route}) => {
  const {scenario} = route.params;
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const [createRoom] = useCreateRoomMutation();
  const {showErrorToast} = useErrorToast();

  const [isOtpModalVisible, setIsOtpModalVisible] = useState(false);
  const [isEmailModalVisible, setIsEmailModalVisible] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  const getRoomData = async () => {
    try {
      setIsCreatingRoom(true);
      const token = await getItem(AsyncStorageKeys.LEARN_ACCESS_TOKEN);
      if (token) {
        const response = await createRoom({scenarioId: scenario.unique_id});
        closeOtpModal();
        return response.data;
      }
      return null;
    } catch (error) {
      showErrorToast(error, 'Errors.createRoom');
      return null;
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const startSimulationPress = async () => {
    try {
      const roomData = await getRoomData();
      if (roomData) {
        navigation.navigate(SCREEN_NAMES.SIMULATION_ASSISTANT, {
          roomData: roomData,
          scenario,
        });
      } else {
        setIsEmailModalVisible(true);
      }
    } catch (error) {
      showErrorToast(error, 'Errors.sendOtp');
    }
  };

  const handleOtpVerificationSuccess = async () => {
    try {
      const roomData = await getRoomData();
      if (roomData) {
        navigation.navigate(SCREEN_NAMES.SIMULATION_ASSISTANT, {
          roomData: roomData,
          scenario,
        });
      }
    } catch (error) {
      showErrorToast(error, 'Errors.navigateAssistant');
    }
  };

  const closeOtpModal = () => {
    setIsOtpModalVisible(false);
  };

  const closeEmailModal = () => {
    setIsEmailModalVisible(false);
  };

  const handleEmailSubmit = (email: string) => {
    setUserEmail(email);
    setIsEmailModalVisible(false);
    setIsOtpModalVisible(true);
  };

  const renderLoadingOverlay = () => {
    return (
      <View style={styles.loadingOverlay}>
        <ActivityIndicator size="large" color={colors.white} />
        <Text style={styles.loadingText}>{t('Simulations.creatingRoom')}</Text>
      </View>
    );
  };

  const renderDetailsSection = () => {
    return (
      <ScrollView contentContainerStyle={styles.container} bounces={false}>
        {!!scenario.cover_image && (
          <Image source={{uri: scenario.cover_image}} style={styles.cover} />
        )}
        <Text style={styles.cardTitle}>{scenario.title || ''}</Text>
        <Text style={styles.fieldLabel}>{t('Simulations.scenarioLabel')}</Text>
        {!!scenario.short_description && (
          <Text style={styles.fieldValue}>
            {scenario.short_description} {scenario.long_description}
          </Text>
        )}
      </ScrollView>
    );
  };

  const renderCtaSection = () => {
    return (
      <View style={styles.ctaWrapper}>
        <PrimaryButton
          label={`${t('Simulations.start')} ${t('Simulations.simulation')}`}
          onPress={startSimulationPress}
          isLoading={isCreatingRoom}
        />
      </View>
    );
  };

  const renderHeader = () => {
    return (
      <>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.headerLeft}>
            <LeftArrowIcon color={colors.black} />
          </TouchableOpacity>
          <Text style={styles.pageTitle}>
            {t('Simulations.start')}{' '}
            <Text style={styles.pageTitleItalic}>
              {t('Simulations.simulation')}
            </Text>
          </Text>
        </View>
      </>
    );
  };

  return (
    <View
      style={[
        styles.safe,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      {isCreatingRoom && renderLoadingOverlay()}
      {renderHeader()}
      {renderDetailsSection()}
      {renderCtaSection()}
      <EmailInputModal
        visible={isEmailModalVisible}
        onClose={closeEmailModal}
        onEmailSubmit={handleEmailSubmit}
      />
      <OtpModal
        visible={isOtpModalVisible}
        onClose={closeOtpModal}
        email={userEmail}
        onOtpVerificationSuccess={handleOtpVerificationSuccess}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.white,
  },
  container: {
    paddingHorizontal: '16@ms',
    paddingBottom: '16@ms',
  },
  cover: {
    width: '100%',
    height: '180@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.lightGray4,
  },
  cardTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.black,
    fontSize: '20@ms',
    marginTop: '18@ms',
    marginBottom: '16@ms',
  },
  fieldLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.black,
    fontSize: '14@ms',
    marginBottom: '2@ms',
    fontWeight: '500',
  },
  fieldValue: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkCharcoal,
    fontSize: '14@ms',
    lineHeight: '22@ms',
    marginBottom: '6@ms',
  },
  ctaWrapper: {
    marginTop: '20@ms',
    marginHorizontal: '24@ms',
    position: 'absolute',
    bottom: '40@ms',
    left: 0,
    right: 0,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingContainer: {
    paddingHorizontal: '24@ms',
    paddingVertical: '16@mvs',
    borderRadius: '8@ms',
    alignItems: 'center',
  },
  loadingText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.white,
    paddingTop: '4@ms',
    fontSize: '14@ms',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
    marginBottom: '18@ms',
    marginHorizontal: '10@ms',
  },
  headerLeft: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '18@ms',
  },
  pageTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
});

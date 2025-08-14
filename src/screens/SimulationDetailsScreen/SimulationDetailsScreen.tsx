import React, {useState} from 'react';
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets';
import {EmailInputModal, OtpModal, PrimaryButton} from '@/components';
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
  const [createRoom] = useCreateRoomMutation();

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
      console.error('Error creating room:', error);
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
        });
      } else {
        setIsEmailModalVisible(true);
      }
    } catch (error) {
      console.error('Failed to get room data:', error);
    }
  };

  const handleOtpVerificationSuccess = async () => {
    try {
      const roomData = await getRoomData();
      if (roomData) {
        navigation.navigate(SCREEN_NAMES.SIMULATION_ASSISTANT, {
          roomData: roomData,
        });
      }
    } catch (error) {
      console.error('Error navigating to simulation assistant:', error);
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
          <Text style={styles.fieldValue}>{scenario.short_description}</Text>
        )}
        <Text style={[styles.fieldLabel, styles.descriptionLabel]}>
          {t('Simulations.descriptionLabel')}
        </Text>
        {!!scenario.long_description && (
          <Text style={styles.fieldValue}>{scenario.long_description}</Text>
        )}
      </ScrollView>
    );
  };

  const renderCtaSection = () => {
    return (
      <View style={styles.ctaWrapper}>
        <PrimaryButton
          label={t('Simulations.audioSimulation')}
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
            {t('Simulations.chooseYour')}{' '}
            <Text style={styles.pageTitleItalic}>
              {t('Simulations.scenarioWord')}
            </Text>
          </Text>
        </View>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>
            {t('Simulations.scenariosCaps')}
          </Text>
          <View style={styles.sectionRule} />
        </View>
      </>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
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
    </SafeAreaView>
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    marginBottom: '12@ms',
    marginHorizontal: '16@ms',
  },
  sectionLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray8,
    fontSize: '12@ms',
    letterSpacing: 2,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    marginRight: '4@ms',
    backgroundColor: colors.lightGray10,
  },
  cover: {
    width: '100%',
    height: '180@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.lightGray4,
  },
  cardTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.black,
    fontWeight: '700',
    fontSize: '20@ms',
    marginTop: '18@ms',
    marginBottom: '16@ms',
  },
  fieldLabel: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.black,
    fontSize: '16@ms',
    marginBottom: '2@ms',
    fontWeight: '500',
  },
  descriptionLabel: {
    marginTop: '12@ms',
    marginBottom: '2@ms',
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
    marginBottom: '8@ms',
    marginHorizontal: '10@ms',
  },
  headerLeft: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '22@ms',
  },
  pageTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
});

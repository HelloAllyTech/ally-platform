import React, {useState} from 'react';
import {Image, SafeAreaView, ScrollView, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {OtpModal, PrimaryButton} from '@/components';
import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {useTranslate} from '@/hooks';
import {useAppNavigation} from '@/hooks/useAppNavigation';
import type {RootStackScreenProps} from '@/navigation/types';
import {
  useCreateRoomMutation,
  useSendOtpMutation,
} from '@/services/simulationsApi';
import {colors, fontFamily} from '@/theme';
import {getItem} from '@/utils/asyncStorage';

type Props = RootStackScreenProps<'SimulationDetails'>;

export const SimulationDetailsScreen: React.FC<Props> = ({route}) => {
  const navigation = useAppNavigation();
  const {scenario} = route.params;
  const {t} = useTranslate();
  const [sendOtp] = useSendOtpMutation();
  const [createRoom] = useCreateRoomMutation();

  const [isOtpModalVisible, setIsOtpModalVisible] = useState(false);

  const userEmail = 'abhay@keyvalue.systems'; // Use your registered(ally learn) email

  const getRoomData = async () => {
    try {
      const token = await getItem(AsyncStorageKeys.LEARN_ACCESS_TOKEN);
      if (token) {
        const response = await createRoom({scenarioId: scenario.unique_id});
        return response.data;
      }
      return null;
    } catch (error) {
      console.error('Error creating room:', error);
      return null;
    }
  };

  const startSimulationPress = async () => {
    try {
      const roomData = await getRoomData();
      if (roomData) {
        navigation.navigate('SimulationAssistant', {roomData: roomData});
      } else {
        await sendOtp({email: userEmail});
        setIsOtpModalVisible(true);
      }
    } catch (error) {
      // Handle error - could show a toast or alert
      console.error('Failed to send OTP:', error);
    }
  };

  const handleOtpVerificationSuccess = async () => {
    try {
      const roomData = await getRoomData();
      if (roomData) {
        navigation.navigate('SimulationAssistant', {roomData: roomData});
      }
    } catch (error) {
      console.error('Error navigating to simulation assistant:', error);
    }
  };

  const closeOtpModal = () => {
    setIsOtpModalVisible(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} bounces={false}>
        <Text style={styles.pageTitle}>
          {t('Simulations.chooseYour')}{' '}
          <Text style={styles.pageTitleItalic}>
            {t('Simulations.scenarioWord')}
          </Text>
        </Text>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>
            {t('Simulations.scenariosCaps')}
          </Text>
          <View style={styles.sectionRule} />
        </View>

        {!!scenario.cover_image && (
          <Image source={{uri: scenario.cover_image}} style={styles.cover} />
        )}

        <Text style={styles.cardTitle}>{scenario.title || 'Simulation'}</Text>

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

        <View style={styles.ctaWrapper}>
          <PrimaryButton
            label={t('Simulations.startSimulation')}
            onPress={startSimulationPress}
          />
        </View>
      </ScrollView>

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
    paddingTop: '50@ms',
    paddingBottom: '20@ms',
  },
  container: {
    paddingHorizontal: '16@ms',
    paddingBottom: '16@ms',
    gap: '12@ms',
  },
  pageTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '28@ms',
  },
  pageTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
    marginTop: '8@ms',
    marginBottom: '8@ms',
  },
  sectionLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray8,
    letterSpacing: 2,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.lightGray6,
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
    fontSize: '22@ms',
    marginTop: '12@ms',
    marginBottom: '6@ms',
  },
  fieldLabel: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.black,
    fontSize: '16@ms',
  },
  descriptionLabel: {
    marginTop: '12@ms',
  },
  fieldValue: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkCharcoal,
    fontSize: '14@ms',
    lineHeight: '22@ms',
    marginTop: '4@ms',
  },
  ctaWrapper: {
    marginTop: '60@ms',
    marginHorizontal: '24@ms',
  },
});

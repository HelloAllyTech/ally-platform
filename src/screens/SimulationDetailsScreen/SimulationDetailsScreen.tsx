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

import {LeftArrowIcon, ShareIcon} from '@/assets';
import {PrimaryButton, useErrorToast, useToast} from '@/components';
import {env} from '@/config/env';
import {isIOS, SCREEN_NAMES} from '@/constants';
import {
  useAppNavigation,
  useHardwareBackPressHandler,
  useTranslate,
} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {useStartScenarioSessionMutation} from '@/services';
import {colors, fontFamily} from '@/theme';
import {copyToClipboard} from '@/utils';

type Props = RootStackScreenProps<'SimulationDetails'>;

export const SimulationDetailsScreen: React.FC<Props> = ({route}) => {
  const {scenario} = route.params;
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const {showErrorToast} = useErrorToast();
  const {showToast} = useToast();

  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [startScenarioSession] = useStartScenarioSessionMutation();

  useHardwareBackPressHandler(() => {
    navigation.goBack();
    return true;
  });

  const linkCopyToClipboard = () => {
    copyToClipboard(`${env.ALLY_WEB_URL}scenario/${scenario.id}`);
    showToast(t('SimulationAssistant.linkCopiedToClipboard'), 'success');
  };

  const startSimulationPress = async () => {
    try {
      setIsCreatingRoom(true);
      const startResp = await startScenarioSession({
        scenarioId: Number(scenario.id),
      }).unwrap();
      if (startResp) {
        navigation.navigate(SCREEN_NAMES.SIMULATION_ASSISTANT, {
          roomData: {
            id: startResp.scenarioSession.id,
            createdAt: startResp.scenarioSession.createdAt,
            accessToken: startResp.accessToken.token,
            liveKitServerUrl: startResp.accessToken.serverUrl,
          },
          scenario,
        });
      }
    } catch (error) {
      showErrorToast(error, 'Errors.startSimulation');
    } finally {
      setIsCreatingRoom(false);
    }
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
        {!!scenario.coverImageUrl && (
          <Image source={{uri: scenario.coverImageUrl}} style={styles.cover} />
        )}
        <View style={styles.row}>
          <Text style={styles.cardTitle}>{scenario.title || ''}</Text>
          <TouchableOpacity onPress={linkCopyToClipboard}>
            <ShareIcon />
          </TouchableOpacity>
        </View>
        <Text style={styles.fieldLabel}>{t('Simulations.scenarioLabel')}</Text>
        {!!scenario.scenario && (
          <Text style={styles.fieldValue}>
            {scenario.scenario}. {scenario.description}
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
    maxWidth: '85%',
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
    paddingTop: isIOS ? '0@vs' : '8@vs',
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingRight: '4@ms',
  },
});

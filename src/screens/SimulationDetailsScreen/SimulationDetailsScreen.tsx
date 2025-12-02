import React, {useEffect, useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
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

import {LeftArrowIcon, NoCreditsIcon, ShareIcon} from '@/assets';
import {
  IllustratedModal,
  PrimaryButton,
  useToast,
  VideoPreview,
} from '@/components';
import {env} from '@/config/env';
import {isIOS, LOW_CREDITS_MODAL_DISPLAY_MS} from '@/constants';
import {
  useAppNavigation,
  useHardwareBackPressHandler,
  useSimulationCredits,
  useStartSimulation,
  useTranslate,
} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {colors, fontFamily} from '@/theme';
import {copyToClipboard} from '@/utils';

import {ActiveSimulationModal} from './components';

type Props = RootStackScreenProps<'SimulationDetails'>;

export const SimulationDetailsScreen: React.FC<Props> = ({route}) => {
  const {scenario} = route.params;
  const isFocused = useIsFocused();
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const {showToast} = useToast();
  const {credits, getCreditsInfo} = useSimulationCredits();

  const {
    isCreatingRoom,
    showActiveSimulationModal,
    activeSimulationId,
    startSimulation,
    closeActiveSimulationModal,
  } = useStartSimulation();

  const [showLowCreditsModal, setShowLowCreditsModal] = useState(false);

  useEffect(() => {
    if (getCreditsInfo?.isLow) {
      setShowLowCreditsModal(true);
      setTimeout(() => {
        setShowLowCreditsModal(false);
      }, LOW_CREDITS_MODAL_DISPLAY_MS);
    }
  }, [getCreditsInfo?.isLow]);

  useHardwareBackPressHandler(() => {
    navigation.goBack();
    return true;
  });

  const linkCopyToClipboard = () => {
    copyToClipboard(`${env.ALLY_WEB_URL}scenario/${scenario.id}`);
    showToast(t('SimulationAssistant.linkCopiedToClipboard'), 'success');
  };

  const startSimulationPress = () => {
    startSimulation(scenario);
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
    const videoUrl = scenario.coverVideoUrl;
    const imageUrl = scenario.coverImageUrl;

    return (
      <ScrollView contentContainerStyle={styles.container} bounces={false}>
        {!!videoUrl && (
          <VideoPreview
            videoUrl={videoUrl}
            autoPlay={false}
            shouldPause={!isFocused}
            testID="scenario-video-preview"
          />
        )}

        {!videoUrl && !!imageUrl && (
          <Image source={{uri: imageUrl}} style={styles.cover} />
        )}

        <View style={styles.row}>
          <Text style={styles.cardTitle}>{scenario.title || ''}</Text>
          <TouchableOpacity onPress={linkCopyToClipboard}>
            <ShareIcon />
          </TouchableOpacity>
        </View>
        <Text style={styles.fieldLabel}>{t('Simulations.scenarioLabel')}</Text>
        <Text style={styles.fieldValue}>{scenario.description}</Text>
      </ScrollView>
    );
  };

  const isStartSimulationDisabled = !!(
    credits &&
    getCreditsInfo &&
    getCreditsInfo.isLow
  );

  const renderCtaSection = () => {
    return (
      <View style={styles.ctaWrapper}>
        <PrimaryButton
          label={`${t('Simulations.start')} ${t('Simulations.simulation')}`}
          onPress={startSimulationPress}
          isLoading={isCreatingRoom}
          isDisabled={isStartSimulationDisabled}
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
      {showActiveSimulationModal && activeSimulationId && (
        <ActiveSimulationModal
          visible={showActiveSimulationModal}
          onClose={closeActiveSimulationModal}
          scenarioSessionId={activeSimulationId}
        />
      )}
      {credits && getCreditsInfo && (
        <IllustratedModal
          visible={showLowCreditsModal}
          onClose={() => setShowLowCreditsModal(false)}
          titleMain={t('Credits.lowCreditsTitle')}
          description={t('Credits.lowCreditsDescription')}
          illustration={<NoCreditsIcon />}
          descriptionStyle={styles.lowCreditsDescription}
        />
      )}
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
    paddingBottom: '90@ms',
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
    paddingTop: '16@ms',
    paddingBottom: '8@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray5,
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
    fontStyle: isIOS ? 'italic' : 'normal',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingRight: '4@ms',
  },
  lowCreditsDescription: {
    fontSize: '14@ms',
    marginHorizontal: '10@ms',
    marginBottom: '-2@ms',
  },
});

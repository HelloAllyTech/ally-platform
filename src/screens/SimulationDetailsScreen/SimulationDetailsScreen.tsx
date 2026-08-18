import {useEffect, useState} from 'react';
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

import {LeftArrowIcon, NoCreditsIcon, ShareIcon, TickRoundIcon} from '@/assets';
import {
  Button,
  CustomDropdown,
  IllustratedModal,
  NotificationModal,
  RichText,
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
import {RetrySessionModal} from '@/screens/CallLog/components';
import {colors, fontFamily, fontWeights, radius, typography} from '@/theme';
import type {LanguageOption} from '@/types';
import {copyToClipboard, getTriggerWarningNames} from '@/utils';

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
    showRetryModal,
    retryStartSimulation,
    closeRetryModal,
  } = useStartSimulation();

  const [showLowCreditsModal, setShowLowCreditsModal] = useState(false);
  const [showNotification, setShowNotification] = useState(false);

  const availableLanguages = scenario.availableLanguages ?? [];
  const [selectedLanguage, setSelectedLanguage] =
    useState<LanguageOption | null>(availableLanguages[0] ?? null);
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);

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
    showToast(t('simulationPage.linkCopiedToClipboard'), 'success');
  };

  const handleLanguageSelect = (selectedLabel: string) => {
    const selected =
      availableLanguages.find(lang => lang.label === selectedLabel) ?? null;
    setSelectedLanguage(selected);
  };

  const startSimulationPress = () => {
    setShowNotification(true);
  };

  const handleConfirmSimulation = () => {
    setShowNotification(false);
    startSimulation({
      scenarioId: scenario.id,
      ...(availableLanguages.length
        ? {languageId: selectedLanguage?.language_id}
        : {}),
    });
  };

  const renderLoadingOverlay = () => {
    return (
      <View style={styles.loadingOverlay}>
        <ActivityIndicator size="large" color={colors.white} />
        <Text style={styles.loadingText}>
          {t('simulationPage.creatingRoom')}
        </Text>
      </View>
    );
  };

  // Completing a scenario never locks it — the CTA turns into an invitation to
  // run it again rather than going away.
  const attemptCount = scenario.completion?.attemptCount ?? 0;

  const renderDetailsSection = () => {
    const videoUrl = scenario.coverVideoUrl;
    const imageUrl = scenario.coverImageUrl;
    const triggerWarnings = getTriggerWarningNames(scenario.triggerWarnings);

    return (
      <ScrollView contentContainerStyle={styles.container} bounces={false}>
        {availableLanguages.length > 0 && (
          <View style={styles.languageDropdownContainer}>
            <CustomDropdown
              value={selectedLanguage?.label ?? ''}
              options={availableLanguages.map(lang => lang.label)}
              onSelect={handleLanguageSelect}
              placeholder={t('nav.language.label')}
              isOpen={isLanguageDropdownOpen}
              setIsOpen={setIsLanguageDropdownOpen}
              disabled={isCreatingRoom}
            />
          </View>
        )}

        <View style={styles.imageContainer}>
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
        </View>

        <View style={styles.row}>
          <Text style={styles.cardTitle}>{scenario.title || ''}</Text>
          <TouchableOpacity onPress={linkCopyToClipboard}>
            <ShareIcon />
          </TouchableOpacity>
        </View>

        {attemptCount > 0 && (
          <View style={styles.completedChip}>
            <TickRoundIcon
              width={14}
              height={14}
              color={colors.ds.green[700]}
            />
            <Text style={styles.completedChipText}>
              {t('simulations.completedChip', {count: attemptCount})}
            </Text>
          </View>
        )}

        <Text style={styles.fieldLabel}>
          {t('learn.scenario.scenarioLabel')}
        </Text>
        <RichText html={scenario.description} style={styles.description} />

        {triggerWarnings.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>
              {t('common.triggerWarnings')}:
            </Text>
            <View style={styles.chipsContainer}>
              {triggerWarnings.map((warning, index) => (
                <View key={index} style={styles.chip}>
                  <Text style={styles.chipText}>{warning}</Text>
                </View>
              ))}
            </View>
          </>
        )}
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
        <Button
          label={
            attemptCount > 0
              ? t('common.practiceAgain')
              : `${t('common.start')} ${t('common.simulation')}`
          }
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
            {t('common.start')}{' '}
            <Text style={styles.pageTitleItalic}>{t('common.simulation')}</Text>
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
          titleMain={t('learn.scenario.noCredits.title')}
          description={t('learn.scenario.noCredits.desc')}
          illustration={<NoCreditsIcon />}
          descriptionStyle={styles.lowCreditsDescription}
        />
      )}
      <NotificationModal
        visible={showNotification}
        onConfirm={handleConfirmSimulation}
        onClose={() => setShowNotification(false)}
      />
      <RetrySessionModal
        visible={showRetryModal}
        onRetry={retryStartSimulation}
        onClose={closeRetryModal}
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
    paddingBottom: '90@ms',
  },
  imageContainer: {
    position: 'relative',
    marginBottom: '12@ms',
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
  description: {
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
    ...typography.display.small,
    fontWeight: fontWeights.light,
    color: colors.ds.typography.highEmphasis,
  },
  pageTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontWeight: fontWeights.light,
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
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: '6@ms',
    marginTop: '6@ms',
  },
  chip: {
    backgroundColor: colors.ds.grey[50],
    borderRadius: radius.full,
    paddingVertical: '4@ms',
    paddingHorizontal: '8@ms',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.grey[300],
  },
  chipText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.large,
    color: colors.ds.typography.mediumEmphasis,
  },
  completedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: '4@ms',
    backgroundColor: colors.ds.green[50],
    borderRadius: radius.full,
    paddingVertical: '4@ms',
    paddingHorizontal: '8@ms',
    marginBottom: '4@ms',
  },
  completedChipText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.label.large,
    color: colors.ds.green[700],
  },
  languageDropdownContainer: {
    marginBottom: '12@ms',
    paddingHorizontal: '0@ms',
  },
  languageSection: {
    marginBottom: '16@ms',
  },
  languageLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.black,
    fontSize: '14@ms',
    marginBottom: '8@ms',
    fontWeight: '500',
  },
});

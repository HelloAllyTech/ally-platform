import {useCallback, useEffect, useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {
  BoltIcon,
  DataUnavailableIcon,
  LeftArrowIcon,
  NoCreditsIcon,
} from '@/assets';
import {IllustratedModal, PrimaryButton, useToast} from '@/components';
import {EmptyState} from '@/components/EmptyState/EmptyState';
import {LOW_CREDITS_MODAL_DISPLAY_MS, SCREEN_NAMES} from '@/constants';
import {
  useHardwareBackPressHandler,
  useLanguageDropdown,
  useSimulationCredits,
  useStartSimulation,
  useTranslate,
} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {ActiveSimulationModal} from '@/screens/SimulationDetailsScreen/components';
import {
  useCreatePathSessionMutation,
  useGetSimulationPathDetailsQuery,
  useLazyGetScenarioSessionByPathItemQuery,
} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {PathScenario, SessionItemStatus} from '@/types';
import {getErrorDetails, navigateToLearnTab} from '@/utils';

import {PathSimulationCard} from './components/PathSimulationCard';
import {ProgressBar} from './components/ProgressBar';
import {SimulationDetailsModal} from './components/SimulationDetailsModal';

export const SimulationPathDetailsScreen: React.FC<
  RootStackScreenProps<typeof SCREEN_NAMES.SIMULATION_PATH_DETAILS>
> = ({navigation, route}) => {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const {pathId} = route.params;
  const {showToast} = useToast();

  const {
    data: pathData,
    isLoading,
    error,
    refetch: refetchPathDetails,
  } = useGetSimulationPathDetailsQuery({pathId});

  const [createPathSession, {isLoading: isCreatingSession}] =
    useCreatePathSessionMutation();

  const [getScenarioSessionByPathItem] =
    useLazyGetScenarioSessionByPathItemQuery();

  const [selectedSimulation, setSelectedSimulation] =
    useState<PathScenario | null>(null);

  const [showLowCreditsModal, setShowLowCreditsModal] = useState(false);

  // Use custom hook for language dropdown management
  const {
    selectedLanguage,
    setSelectedLanguage,
    isLanguageDropdownOpen,
    setIsLanguageDropdownOpen,
    languageOptions,
    languageMap,
  } = useLanguageDropdown({isFocused});

  const {credits, getCreditsInfo} = useSimulationCredits();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchPathDetails();
    } finally {
      setRefreshing(false);
    }
  }, [refetchPathDetails]);

  useEffect(() => {
    if (getCreditsInfo?.isLow) {
      setShowLowCreditsModal(true);
      setTimeout(() => {
        setShowLowCreditsModal(false);
      }, LOW_CREDITS_MODAL_DISPLAY_MS);
    }
  }, [getCreditsInfo?.isLow]);

  const checkAndCreatePathSession = async () => {
    if (pathData && !pathData.scenarioPathSessionId) {
      try {
        await createPathSession({pathId}).unwrap();
        const result = await refetchPathDetails();
        if (result.data?.scenarioPathSessionId) {
          setSelectedSimulation(result.data.scenarios[0]);
        }
      } catch (err) {
        showToast(getErrorDetails(err)?.message, 'error');
      }
    }
  };

  const {
    isCreatingRoom,
    startSimulation,
    showActiveSimulationModal,
    activeSimulationId,
    closeActiveSimulationModal,
  } = useStartSimulation();

  const nextSimulation = pathData?.scenarios?.find(
    scenario =>
      scenario.status !== SessionItemStatus.COMPLETED &&
      scenario.status !== SessionItemStatus.LOCKED,
  );

  const isPathStarted = (pathData?.completedScenarios ?? 0) > 0;
  const isPathCompleted = !!pathData?.completedAt;

  const isStartPathDisabled =
    !nextSimulation || !!(credits && getCreditsInfo && getCreditsInfo.isLow);

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigateToLearnTab(navigation);
  };

  useHardwareBackPressHandler(() => {
    handleBack();
    return true;
  });

  const handleStartPath = async () => {
    if (!pathData?.scenarioPathSessionId) {
      await checkAndCreatePathSession();
      return;
    }
    if (!nextSimulation) return;
    setSelectedSimulation(nextSimulation);
  };

  /**
   * Handle simulation card press
   * - If completed: Show modal to allow retry
   * - Otherwise: Open simulation details modal
   * Only unlocked simulations are clickable (locked ones have disabled press)
   */
  const handleSimulationPress = async (scenario: PathScenario) => {
    if (!pathData?.scenarioPathSessionId) {
      await checkAndCreatePathSession();
      return;
    }
    if (scenario.status === SessionItemStatus.LOCKED) {
      return;
    }

    // For all clickable simulations (including completed), open the modal
    setSelectedSimulation(scenario);
  };

  /**
   * Handle file icon press - navigate to simulation feedback screen
   * Only available for completed simulations
   */
  const handleFileIconPress = async (scenario: PathScenario) => {
    if (
      scenario.status !== SessionItemStatus.COMPLETED ||
      !scenario.sessionId
    ) {
      return;
    }

    try {
      // Fetch the actual scenario session ID using the path session item ID
      const response = await getScenarioSessionByPathItem({
        pathSessionItemId: scenario.sessionId,
      }).unwrap();

      if (response?.id) {
        // Navigate to feedback screen with the actual scenario session ID
        navigation.navigate(SCREEN_NAMES.SIMULATION_FEEDBACK, {
          scenarioSessionId: response.id,
          pathId,
          fromLogs: true,
        });
      } else {
        showToast('Failed to load simulation details', 'error');
      }
    } catch (err) {
      showToast(getErrorDetails(err)?.message, 'error');
    }
  };

  /**
   * Close the simulation details modal
   */
  const handleCloseModal = () => {
    setSelectedSimulation(null);
  };

  /**
   * Start the selected simulation
   */
  const handleStartSimulation = () => {
    if (selectedSimulation) {
      const languageId = languageMap.get(selectedLanguage);
      startSimulation(
        selectedSimulation.scenarioId,
        selectedSimulation.sessionId || undefined,
        pathId,
        languageId,
      ).finally(() => {
        handleCloseModal();
      });
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={handleBack} style={styles.backButton}>
        <LeftArrowIcon color={colors.ds.typography.highEmphasis} />
      </TouchableOpacity>
      <Text style={styles.pageTitle}>{t('Simulations.track')}</Text>
      <View style={styles.headerSpacer} />
      {credits && getCreditsInfo && (
        <View style={styles.creditDisplay}>
          <BoltIcon width={14} height={14} />
          <Text
            style={[
              styles.creditText,
              getCreditsInfo.isLow && styles.creditTextLow,
            ]}>
            {credits.consumedCredits}
            <Text style={styles.creditLimitText}>/{credits.creditLimit}</Text>
          </Text>
        </View>
      )}
    </View>
  );

  const totalScenarios = pathData?.scenarios?.length ?? 0;
  const showProgressBar = !!pathData?.completedScenarios && totalScenarios > 0;

  const renderListHeaderComponent = () => {
    if (!pathData) return null;

    return (
      <View style={styles.listHeaderSection}>
        {!!pathData.coverImageUrl && (
          <Image
            source={{uri: pathData.coverImageUrl}}
            style={styles.coverImage}
            resizeMode="cover"
          />
        )}
        <View style={styles.listHeaderContent}>
          <Text style={styles.pathTitle}>{pathData.title}</Text>
          <Text style={styles.pathDescription}>
            {pathData.description ?? ''}
          </Text>

          {/* Progress bar - shows completion status */}
          {showProgressBar && (
            <View style={styles.progressBarContainer}>
              <ProgressBar
                current={pathData.completedScenarios}
                total={totalScenarios}
              />
            </View>
          )}

          {/* Start/Continue button - only show if path is not completed */}
          {!isPathCompleted && (
            <PrimaryButton
              label={
                isPathStarted
                  ? t('Simulations.continue')
                  : t('Simulations.start')
              }
              onPress={handleStartPath}
              isDisabled={isStartPathDisabled}
              isLoading={isCreatingSession}
            />
          )}
        </View>
      </View>
    );
  };

  const renderSimulationItem = ({
    item,
  }: {
    item: PathScenario;
    index: number;
  }) => {
    // Only show "Next" badge if path has been started and this is the next item
    const isNext = isPathStarted && nextSimulation?.id === item.id;

    return (
      <PathSimulationCard
        order={item.order}
        title={item.title ?? ''}
        thumbnailUrl={item.coverImageUrl}
        isLocked={item.status === SessionItemStatus.LOCKED}
        isCompleted={item.status === SessionItemStatus.COMPLETED}
        isNext={isNext}
        onPress={() => handleSimulationPress(item)}
        onFileIconPress={() => handleFileIconPress(item)}
      />
    );
  };

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      {renderHeader()}
      {isLoading ? (
        <ActivityIndicator
          size="large"
          color={colors.ds.theme.primary}
          style={styles.loadingContainer}
          testID="activity-indicator"
        />
      ) : error || !pathData?.scenarios ? (
        <EmptyState
          icon={DataUnavailableIcon}
          title={t('Simulations.failedToLoadPathDetails')}
        />
      ) : (
        <FlatList
          data={pathData?.scenarios || []}
          keyExtractor={item => item.id.toString()}
          renderItem={renderSimulationItem}
          ListHeaderComponent={renderListHeaderComponent}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}

      <SimulationDetailsModal
        visible={!!selectedSimulation?.sessionId}
        onClose={handleCloseModal}
        {...(selectedSimulation ?? {})}
        onStartSimulation={handleStartSimulation}
        isCreatingRoom={isCreatingRoom}
        selectedLanguage={selectedLanguage}
        languageOptions={languageOptions}
        onLanguageSelect={setSelectedLanguage}
        isLanguageDropdownOpen={isLanguageDropdownOpen}
        setIsLanguageDropdownOpen={setIsLanguageDropdownOpen}
      />

      {/* Active Simulation Modal - Separate from Details Modal */}
      {showActiveSimulationModal && !!activeSimulationId && (
        <ActiveSimulationModal
          visible={showActiveSimulationModal}
          onClose={closeActiveSimulationModal}
          scenarioSessionId={activeSimulationId}
        />
      )}

      {/* Low Credits Modal */}
      {credits && getCreditsInfo && (
        <IllustratedModal
          visible={showLowCreditsModal}
          onClose={() => setShowLowCreditsModal(false)}
          titleMain={t('Credits.lowCreditsTitle')}
          description={t('Credits.lowCreditsDescription')}
          illustration={<NoCreditsIcon />}
        />
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16@ms',
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
    borderBottomColor: colors.ds.stroke.primary,
  },
  backButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
    color: colors.ds.typography.highEmphasis,
  },
  headerSpacer: {
    flex: 1,
  },
  creditDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  creditText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.display.small,
    fontWeight: fontWeights.medium,
  },
  creditTextLow: {
    color: colors.ds.red[300],
  },
  creditLimitText: {
    ...typography.body.tiny,
    color: colors.darkGray,
  },
  scrollContent: {
    paddingHorizontal: '21@ms',
    paddingBottom: '32@ms',
  },
  listHeaderSection: {
    marginBottom: '16@ms',
  },
  coverImage: {
    width: '100%',
    height: '177@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.ds.grey[200],
    marginBottom: '16@ms',
  },
  listHeaderContent: {
    gap: '12@ms',
  },
  pathTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.display.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
  },
  pathDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  progressBarContainer: {
    marginVertical: '12@ms',
    width: '60%',
    alignSelf: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

import {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, RefreshControl, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {DataUnavailableIcon, NoCreditsIcon} from '@/assets';
import {
  EmptyState,
  IllustratedModal,
  LearningPathHeader,
  LearningPathListHeader,
  NotificationModal,
  useToast,
} from '@/components';
import {
  LearningPathType,
  LOW_CREDITS_MODAL_DISPLAY_MS,
  SCREEN_NAMES,
} from '@/constants';
import {
  useHardwareBackPressHandler,
  useLearningPathDetails,
  useSimulationCredits,
  useStartSimulation,
  useTranslate,
} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {RetrySessionModal} from '@/screens/CallLog/components';
import {ActiveSimulationModal} from '@/screens/SimulationDetailsScreen/components';
import {colors} from '@/theme';
import {LanguageOption, PathScenario, SessionItemStatus} from '@/types';
import {getErrorDetails, navigateToLearnTab} from '@/utils';

import {PathSimulationCard} from './components/PathSimulationCard';
import {SimulationDetailsModal} from './components/SimulationDetailsModal';

export const SimulationPathDetailsScreen: React.FC<
  RootStackScreenProps<typeof SCREEN_NAMES.SIMULATION_PATH_DETAILS>
> = ({navigation, route}) => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const {pathId} = route.params;
  const {showToast} = useToast();

  const {
    data: pathData,
    isLoading,
    error,
    refetch,
    createSession,
    isCreatingSession,
    getSessionByItem,
  } = useLearningPathDetails({id: pathId, type: LearningPathType.TRACK});

  const [selectedSimulation, setSelectedSimulation] =
    useState<PathScenario | null>(null);

  const [showLowCreditsModal, setShowLowCreditsModal] = useState(false);
  const [showNotification, setShowNotification] = useState(false);

  const [selectedLanguage, setSelectedLanguage] =
    useState<LanguageOption | null>(null);
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);

  const availableLanguages = selectedSimulation?.availableLanguages ?? [];

  useEffect(() => {
    if (selectedSimulation?.availableLanguages?.length) {
      setSelectedLanguage(selectedSimulation.availableLanguages[0]);
    } else {
      setSelectedLanguage(null);
    }
  }, [selectedSimulation]);

  const handleLanguageSelect = (label: string) => {
    const selected =
      availableLanguages.find(lang => lang.label === label) ?? null;
    setSelectedLanguage(selected);
  };

  const {credits, getCreditsInfo} = useSimulationCredits();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  useEffect(() => {
    if (getCreditsInfo?.isLow) {
      setShowLowCreditsModal(true);
      setTimeout(() => {
        setShowLowCreditsModal(false);
      }, LOW_CREDITS_MODAL_DISPLAY_MS);
    }
  }, [getCreditsInfo?.isLow]);

  const {
    isCreatingRoom,
    startSimulation,
    showActiveSimulationModal,
    activeSimulationId,
    closeActiveSimulationModal,
    showRetryModal,
    retryStartSimulation,
    closeRetryModal,
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
      try {
        await createSession();
      } catch (err) {
        showToast(getErrorDetails(err)?.message, 'error');
        return;
      }
    }
    if (!nextSimulation) return;
    setSelectedSimulation(nextSimulation);
  };

  const handleSimulationPress = async (scenario: PathScenario) => {
    if (scenario.status === SessionItemStatus.LOCKED) {
      return;
    }
    if (!pathData?.scenarioPathSessionId) {
      try {
        await createSession();
      } catch (err) {
        showToast(getErrorDetails(err)?.message, 'error');
        return;
      }
    }
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
      const response = await getSessionByItem(scenario.sessionId);

      if (response?.id) {
        navigation.navigate(SCREEN_NAMES.SIMULATION_FEEDBACK, {
          scenarioSessionId: response.id,
          pathId,
          fromLogs: true,
        });
      } else {
        showToast(t('simulationPage.failedToLoadPathDetails'), 'error');
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
      setShowNotification(true);
    }
  };

  const handleProceedWithSimulation = () => {
    setShowNotification(false);
    if (selectedSimulation) {
      const freshScenario = pathData?.scenarios?.find(
        s => s.id === selectedSimulation.id,
      );
      startSimulation({
        scenarioId: selectedSimulation.scenarioId,
        scenarioPathSessionItemId:
          (freshScenario ?? selectedSimulation).sessionId || undefined,
        pathId,
        ...(availableLanguages.length
          ? {languageId: selectedLanguage?.language_id}
          : {}),
      }).finally(() => {
        handleCloseModal();
      });
    }
  };

  const totalScenarios = pathData?.scenarios?.length ?? 0;

  const renderListHeaderComponent = () => {
    if (!pathData) return null;

    return (
      <LearningPathListHeader
        title={pathData.title}
        description={pathData.description}
        coverImageUrl={pathData.coverImageUrl}
        completedScenarios={pathData.completedScenarios}
        totalScenarios={totalScenarios}
        isCompleted={isPathCompleted}
        startButtonLabel={
          isPathStarted ? t('common.continue') : t('common.start')
        }
        onStartPress={handleStartPath}
        isStartDisabled={isStartPathDisabled}
        isCreatingSession={isCreatingSession}
      />
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
      <LearningPathHeader
        title={t('learn.choose.track')}
        onBackPress={handleBack}
        credits={
          credits && getCreditsInfo
            ? {
                consumed: credits.consumedCredits,
                limit: credits.creditLimit,
                isLow: getCreditsInfo.isLow,
              }
            : undefined
        }
      />
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
          title={t('simulationPage.failedToLoadPathDetails')}
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
        visible={!!selectedSimulation && !showNotification}
        onClose={handleCloseModal}
        {...(selectedSimulation ?? {})}
        onStartSimulation={handleStartSimulation}
        isCreatingRoom={isCreatingRoom}
        selectedLanguage={selectedLanguage?.label ?? ''}
        languageOptions={availableLanguages.map(lang => lang.label)}
        onLanguageSelect={handleLanguageSelect}
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

      <NotificationModal
        visible={showNotification}
        onConfirm={handleProceedWithSimulation}
        onClose={() => setShowNotification(false)}
      />

      {/* Low Credits Modal */}
      {credits && getCreditsInfo && (
        <IllustratedModal
          visible={showLowCreditsModal}
          onClose={() => setShowLowCreditsModal(false)}
          titleMain={t('learn.scenario.noCredits.title')}
          description={t('learn.scenario.noCredits.desc')}
          illustration={<NoCreditsIcon />}
        />
      )}

      <RetrySessionModal
        visible={showRetryModal}
        onRetry={retryStartSimulation}
        onClose={closeRetryModal}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  scrollContent: {
    paddingHorizontal: '21@ms',
    paddingBottom: '32@ms',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

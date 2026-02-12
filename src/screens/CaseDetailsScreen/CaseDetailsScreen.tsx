import {useCallback, useEffect, useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
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
  useLanguageDropdown,
  useLearningPathDetails,
  useSimulationCredits,
  useStartSimulation,
  useTranslate,
} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {ActiveSimulationModal} from '@/screens/SimulationDetailsScreen/components';
import {PathSimulationCard} from '@/screens/SimulationPathDetailsScreen/components/PathSimulationCard';
import {SimulationDetailsModal} from '@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal';
import {colors} from '@/theme';
import {CaseSimulation, SessionItemStatus} from '@/types';
import {getErrorDetails, navigateToLearnTab} from '@/utils';

export const CaseDetailsScreen: React.FC<
  RootStackScreenProps<typeof SCREEN_NAMES.CASE_DETAILS>
> = ({navigation, route}) => {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const {caseId} = route.params;
  const {showToast} = useToast();

  const {
    data,
    isLoading,
    error,
    refetch,
    createSession,
    isCreatingSession,
    getSessionByItem,
  } = useLearningPathDetails({id: caseId, type: LearningPathType.CASE});

  const [selectedSimulation, setSelectedSimulation] =
    useState<CaseSimulation | null>(null);

  const [showLowCreditsModal, setShowLowCreditsModal] = useState(false);
  const [showNotification, setShowNotification] = useState(false);

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

  const checkAndCreateSession = async () => {
    if (data && !data.scenarioPathSessionId) {
      try {
        await createSession();
        await refetch();
        // Refetch will update the data, so we can access it directly
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

  const nextSimulation = data?.scenarios?.find(
    scenario =>
      scenario.status !== SessionItemStatus.COMPLETED &&
      scenario.status !== SessionItemStatus.LOCKED,
  );

  const isStarted = (data?.completedScenarios ?? 0) > 0;
  const isCompleted = !!data?.completedAt;

  const isStartDisabled =
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

  const handleStart = async () => {
    if (!data || !data.caseSessionId) {
      await checkAndCreateSession();
      return;
    }
    if (!nextSimulation) return;
    setSelectedSimulation(nextSimulation);
  };

  const handleSimulationPress = async (scenario: CaseSimulation) => {
    if (!data || !data.caseSessionId) {
      await checkAndCreateSession();
      return;
    }
    if (scenario.status === SessionItemStatus.LOCKED) {
      return;
    }

    setSelectedSimulation(scenario);
  };

  const handleFileIconPress = async (scenario: CaseSimulation) => {
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
          caseId,
          fromLogs: true,
        });
      } else {
        showToast('Failed to load simulation details', 'error');
      }
    } catch (err) {
      showToast(getErrorDetails(err)?.message, 'error');
    }
  };

  const handleCloseModal = () => {
    setSelectedSimulation(null);
  };

  const handleStartSimulation = () => {
    if (selectedSimulation) {
      setShowNotification(true);
    }
  };

  const handleProceedWithSimulation = () => {
    setShowNotification(false);
    if (selectedSimulation) {
      const languageId = languageMap.get(selectedLanguage);
      startSimulation({
        scenarioId: selectedSimulation.scenarioId,
        caseSessionItemId: selectedSimulation.sessionId || '',
        languageId,
        caseId,
      }).finally(() => {
        handleCloseModal();
      });
    }
  };

  const totalScenarios = data?.scenarios?.length ?? 0;

  const renderListHeaderComponent = () => {
    if (!data) return null;

    return (
      <LearningPathListHeader
        title={data.title}
        description={data.description}
        coverImageUrl={data.coverImageUrl}
        completedScenarios={data.completedScenarios}
        totalScenarios={totalScenarios}
        isCompleted={isCompleted}
        startButtonLabel={
          isStarted ? t('Simulations.continue') : t('Simulations.start')
        }
        onStartPress={handleStart}
        isStartDisabled={isStartDisabled}
        isCreatingSession={isCreatingSession}
      />
    );
  };

  const renderSimulationItem = ({
    item,
  }: {
    item: CaseSimulation;
    index: number;
  }) => {
    const isNext = isStarted && nextSimulation?.id === item.id;

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
        title={t('Simulations.case')}
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
      ) : error || !data?.scenarios ? (
        <EmptyState
          icon={DataUnavailableIcon}
          title={t('Simulations.failedToLoadCaseDetails')}
        />
      ) : (
        <FlatList
          data={data?.scenarios || []}
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
        visible={!!selectedSimulation?.sessionId && !showNotification}
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

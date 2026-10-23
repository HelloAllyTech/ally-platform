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
import {PathSimulationCard} from '@/screens/SimulationPathDetailsScreen/components/PathSimulationCard';
import {SimulationDetailsModal} from '@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal';
import {colors} from '@/theme';
import {CaseSimulation, LanguageOption, SessionItemStatus} from '@/types';
import {getErrorDetails, navigateToLearnTab} from '@/utils';

export const CaseDetailsScreen: React.FC<
  RootStackScreenProps<typeof SCREEN_NAMES.CASE_DETAILS>
> = ({navigation, route}) => {
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
    if (!data?.caseSessionId) {
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

  const handleSimulationPress = async (scenario: CaseSimulation) => {
    if (scenario.status === SessionItemStatus.LOCKED) {
      return;
    }
    if (!data?.caseSessionId) {
      try {
        await createSession();
      } catch (err) {
        showToast(getErrorDetails(err)?.message, 'error');
        return;
      }
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
        showToast(t('simulationPage.failedToLoadCaseDetails'), 'error');
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
      const freshScenario = data?.scenarios?.find(
        s => s.id === selectedSimulation.id,
      );
      startSimulation({
        scenarioId: selectedSimulation.scenarioId,
        caseSessionItemId:
          (freshScenario ?? selectedSimulation).sessionId || '',
        caseId,
        ...(availableLanguages.length
          ? {languageId: selectedLanguage?.language_id}
          : {}),
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
        startButtonLabel={isStarted ? t('common.continue') : t('common.start')}
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
        title={t('learn.choose.case')}
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
          title={t('simulationPage.failedToLoadCaseDetails')}
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

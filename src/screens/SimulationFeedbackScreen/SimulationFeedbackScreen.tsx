import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  SafeAreaView,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {ArrowDown, ChevronDown, LeftArrowIcon} from '@/assets';
import {FeedbackPopup, PrimaryButton, useToast} from '@/components';
import {SCREEN_NAMES, USER_PERMISSIONS} from '@/constants';
import {
  useAppNavigation,
  useHardwareBackPressHandler,
  useStartSimulation,
} from '@/hooks';
import {RootStackScreenProps} from '@/navigation/types';
import {
  useAddSimulationFeedbackMutation,
  useLazyGetSimulationDetailsQuery,
  useLazyGetUpcomingScenarioQuery,
} from '@/services';
import {useAppSelector} from '@/store/hooks';
import {colors, globalStyles} from '@/theme';
import {navigateToLearnTab} from '@/utils';

import {
  FeedbackDropdown,
  SimulationSummary,
  SimulationSummarySkeleton,
  SimulationTranscript,
  UpNextSimulationCard,
} from './components';
import {styles} from './styles';

const RETRY_COUNT_LIMIT = 4;
const RETRY_DELAY = 5000;
const FEEDBACK_THRESHOLD = 30 * 1000;

export const SimulationFeedbackScreen: React.FC<
  RootStackScreenProps<'SimulationFeedback'>
> = ({route}) => {
  const {fromLogs, scenarioSessionId, pathSessionItemId, pathId} = route.params;
  const permissions = useAppSelector(state => state.user.permissions);
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();

  const [mountTime] = useState<number>(Date.now());
  const [showScrollButton, setShowScrollButton] = useState<boolean>(false);
  const [showSummary, setShowSummary] = useState<boolean>(true);
  const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);
  const [retryLimitReached, setRetryLimitReached] = useState<boolean>(false);
  const [isFeedbackPopupVisible, setIsFeedbackPopupVisible] =
    useState<boolean>(false);

  const navigation = useAppNavigation();
  const [addSimulationFeedback] = useAddSimulationFeedbackMutation();
  const [
    getSimulationDetails,
    {data: simulationDetails, isLoading: isSimulationDetailsLoading},
  ] = useLazyGetSimulationDetailsQuery();
  const [getUpcomingScenario, {data: upNextData}] =
    useLazyGetUpcomingScenarioQuery();
  const {startSimulation, isCreatingRoom: isStartingSimulation} =
    useStartSimulation();
  const {showToast} = useToast();
  const scrollViewRef = useRef<KeyboardAwareScrollView>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSimulationDetailsWithRetry = async (
    currentRetryCount: number = 0,
  ) => {
    // Use scenarioSessionId if available, otherwise use pathSessionItemId
    const sessionId = scenarioSessionId || pathSessionItemId;
    if (!sessionId) return;

    try {
      const response = await getSimulationDetails({
        id: sessionId.toString(),
      });
      if (!response.data?.details && currentRetryCount < RETRY_COUNT_LIMIT) {
        const nextRetryCount = currentRetryCount + 1;

        retryTimeoutRef.current = setTimeout(() => {
          fetchSimulationDetailsWithRetry(nextRetryCount);
        }, RETRY_DELAY);
      } else if (currentRetryCount >= RETRY_COUNT_LIMIT) {
        setRetryLimitReached(true);
        showToast(t('SimulationFeedback.failedToFetchDetails'), 'error');
      }
    } catch (error) {
      if (currentRetryCount < RETRY_COUNT_LIMIT) {
        const nextRetryCount = currentRetryCount + 1;
        retryTimeoutRef.current = setTimeout(() => {
          fetchSimulationDetailsWithRetry(nextRetryCount);
        }, RETRY_DELAY);
      } else {
        setRetryLimitReached(true);
        showToast(t('SimulationFeedback.failedToFetchDetails'), 'error');
      }
    }
  };

  useEffect(() => {
    if (scenarioSessionId && pathSessionItemId) {
      getUpcomingScenario({
        scenarioSessionId: scenarioSessionId,
      });
    }
  }, [scenarioSessionId, pathSessionItemId, getUpcomingScenario]);

  useHardwareBackPressHandler(() => {
    if (fromLogs) {
      onBackPress();
      return true;
    }
    navigateToLearnTab(navigation);
    return true;
  });

  const onBackPress = () => {
    const currentTime = Date.now();
    const timeElapsed = currentTime - mountTime;

    if (timeElapsed >= FEEDBACK_THRESHOLD && !simulationDetails?.hasFeedback) {
      setIsFeedbackPopupVisible(true);
      return true;
    }
    navigation.goBack();
  };

  const submitFeedback = async (
    rating: number,
    {comment}: {issues: string[]; comment: string},
  ) => {
    if (rating === 0) return;
    try {
      const response = await addSimulationFeedback({
        scenarioSessionId: scenarioSessionId?.toString() || '',
        rating,
        comment,
      });
      if (response.data) {
        showToast(t('Success.submitFeedback'), 'success');
      } else {
        showToast(t('Errors.submitFeedback'), 'error');
      }
    } catch (error) {
      showToast(t('Errors.submitFeedback'), 'error');
      hideFeedbackPopup();
    }
    if (fromLogs) {
      navigation.goBack();
    } else {
      navigateToLearnTab(navigation);
    }
  };

  useEffect(() => {
    if (scenarioSessionId) {
      setRetryLimitReached(false);
      fetchSimulationDetailsWithRetry(0);
    }

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioSessionId]);

  const hideFeedbackPopup = () => {
    setIsFeedbackPopupVisible(false);
  };

  const handleSubmit = () => {
    setIsFeedbackPopupVisible(true);
  };

  const handleScrollToBottom = useCallback(() => {
    scrollViewRef.current?.scrollToEnd();
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
      const isNearBottom =
        contentOffset.y + layoutMeasurement.height >= contentSize.height - 100;
      setShowScrollButton(!isNearBottom);
    },
    [],
  );

  const onHeaderPress = () => setIsDropdownVisible(true);
  const hideHeaderDropdown = () => setIsDropdownVisible(false);

  const handleBackToPath = () => {
    if (pathId) {
      // Navigate to path details screen using replace to clear the stack
      navigation.replace(SCREEN_NAMES.SIMULATION_PATH_DETAILS, {pathId});
    } else {
      // Fallback to Learn tab if no pathId
      navigateToLearnTab(navigation);
    }
  };

  const handleNextSimulation = () => {
    if (upNextData && upNextData.scenarioPathSessionItemId) {
      startSimulation(
        {
          id: upNextData.id,
          title: upNextData.title || '',
          description: upNextData.description || '',
          coverImageUrl: upNextData.coverImageUrl,
          coverVideoUrl: upNextData.coverVideoUrl,
        },
        upNextData.scenarioPathSessionItemId,
        pathId,
      );
    }
  };

  const renderButtonContainer = () => {
    // For scenarios part of a path, show Back and Next buttons
    if (pathSessionItemId) {
      return (
        <View style={styles.pathNavigationContainer}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBackToPath}
            activeOpacity={0.7}>
            <Text style={styles.backButtonText}>{t('Common.back')}</Text>
          </TouchableOpacity>
          {upNextData && (
            <PrimaryButton
              label={t('Common.next')}
              onPress={handleNextSimulation}
              customContainerStyle={styles.nextButton}
              isLoading={isStartingSimulation}
            />
          )}
        </View>
      );
    }

    // For normal simulations, show "Try Another" button
    return (
      <View style={styles.buttonContainer}>
        <PrimaryButton
          label={t('SimulationFeedback.tryAnother')}
          onPress={handleSubmit}
          customContainerStyle={styles.submitButton}
        />
      </View>
    );
  };

  const renderTitle = () => {
    return (
      <Text style={styles.title}>
        {t('SimulationFeedback.title')}{' '}
        <Text style={styles.titleItalic}>
          {showSummary
            ? !fromLogs
              ? t('SimulationFeedback.titleEnded')
              : t('CallSummary.header.subtitle')
            : t('SimulationFeedback.transcript')}
        </Text>
      </Text>
    );
  };
  const showTranscript = !isSimulationDetailsLoading && !showSummary;
  const disableDropdown =
    !fromLogs ||
    !permissions?.includes(USER_PERMISSIONS.VIEW_SESSION_SCENARIO_MESSAGES);

  return (
    <SafeAreaView
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.titleSection}>
        <View style={styles.titleRow}>
          {fromLogs && (
            <TouchableOpacity
              onPress={onBackPress}
              style={styles.backArrowButton}>
              <LeftArrowIcon color={colors.black} />
            </TouchableOpacity>
          )}
          <View style={globalStyles.column}>
            <TouchableOpacity
              style={[
                globalStyles.rowCenter,
                !fromLogs && styles.titleExtraPadding,
              ]}
              onPress={onHeaderPress}
              disabled={disableDropdown}
              activeOpacity={0.8}>
              {renderTitle()}
              {fromLogs && (
                <View style={styles.arrowDownContainer}>
                  <ArrowDown width={9} height={5} />
                </View>
              )}
            </TouchableOpacity>
            {fromLogs && simulationDetails?.metadata?.sessionName && (
              <Text style={styles.subTitle}>
                {simulationDetails.metadata.sessionName}
              </Text>
            )}
          </View>
        </View>
      </View>
      {showSummary && (
        <KeyboardAwareScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          extraScrollHeight={100}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}>
          {!simulationDetails?.details && !retryLimitReached ? (
            <SimulationSummarySkeleton />
          ) : (
            <>
              {simulationDetails && (
                <SimulationSummary data={simulationDetails} />
              )}
              {!!pathSessionItemId && upNextData && (
                <>
                  {/* Transition message section */}
                  {(upNextData.transitionMessageTitle ||
                    upNextData.transitionMessageContent) && (
                    <View style={styles.transitionMessageContainer}>
                      {upNextData.transitionMessageTitle && (
                        <Text style={styles.transitionMessageTitle}>
                          {upNextData.transitionMessageTitle}
                        </Text>
                      )}
                      {upNextData.transitionMessageContent && (
                        <Text style={styles.transitionMessageContent}>
                          {upNextData.transitionMessageContent}
                        </Text>
                      )}
                    </View>
                  )}
                  <UpNextSimulationCard upNext={upNextData} />
                </>
              )}
              {!fromLogs && simulationDetails && renderButtonContainer()}
            </>
          )}
        </KeyboardAwareScrollView>
      )}
      {showTranscript && scenarioSessionId && (
        <SimulationTranscript
          sessionId={scenarioSessionId}
          startedAt={simulationDetails?.startedAt}
        />
      )}
      <FeedbackDropdown
        visible={isDropdownVisible}
        onClose={hideHeaderDropdown}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
      />
      <FeedbackPopup
        visible={isFeedbackPopupVisible}
        onClose={hideFeedbackPopup}
        onSubmit={submitFeedback}
        showChips={false}
        placeholder={t('SimulationFeedback.placeholderText')}
        customTitle={t('SimulationFeedback.questionText')}
      />
      {showScrollButton && !isSimulationDetailsLoading && (
        <TouchableOpacity
          onPress={handleScrollToBottom}
          style={styles.scrollToBottomButton}>
          <ChevronDown width={14} height={14} color={colors.lightGray4} />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

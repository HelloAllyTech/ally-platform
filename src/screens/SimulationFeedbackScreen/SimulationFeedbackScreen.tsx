import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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

import {ChevronDown, CommentIcon, LeftArrowIcon} from '@/assets';
import {
  CustomTabs,
  FeedbackPopup,
  PrimaryButton,
  SessionChecklist,
  useToast,
} from '@/components';
import {
  LearningPathType,
  SCREEN_NAMES,
  SimulationEventStatus,
  USER_PERMISSIONS,
} from '@/constants';
import {
  useAppNavigation,
  useHardwareBackPressHandler,
  useStartSimulation,
} from '@/hooks';
import {RootStackScreenProps} from '@/navigation/types';
import {
  useAddSimulationFeedbackMutation,
  useCreateReviewMutation,
  useGetUpcomingScenarioQuery,
  useLazyGetReactionsCountQuery,
  useLazyGetSimulationDetailsQuery,
  useUpdateReviewStatusMutation,
} from '@/services';
import {useLazyGetThreadsQuery} from '@/services/reviewThreadsApi';
import {useAppSelector} from '@/store/hooks';
import {colors, globalStyles} from '@/theme';
import {ReviewStatus, SessionItemStatus} from '@/types';
import {navigateToLearnTab} from '@/utils';

import {
  PrivacyToggle,
  Reflection,
  SessionSkills,
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
  const {
    fromLogs,
    scenarioSessionId,
    pathId,
    contextType = LearningPathType.TRACK,
  } = route.params;
  const isCase = contextType === LearningPathType.CASE;
  const permissions = useAppSelector(state => state.user.permissions);
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();

  const [mountTime] = useState<number>(Date.now());
  const [showScrollButton, setShowScrollButton] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [retryLimitReached, setRetryLimitReached] = useState<boolean>(false);
  const [isFeedbackPopupVisible, setIsFeedbackPopupVisible] =
    useState<boolean>(false);
  const [pollingInterval, setPollingInterval] = useState<number>(3000);
  const nextSimulationPollingAttemptsRef = useRef<number>(0);

  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [isPrivate, setIsPrivate] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [hideReviewDetails, setHideReviewDetails] = useState<boolean>(false);

  const navigation = useAppNavigation();
  const [addSimulationFeedback] = useAddSimulationFeedbackMutation();
  const [createReview] = useCreateReviewMutation();
  const [updateReviewStatus] = useUpdateReviewStatusMutation();
  const [
    getSimulationDetails,
    {data: simulationDetails, isLoading: isSimulationDetailsLoading},
  ] = useLazyGetSimulationDetailsQuery();
  const {data: upcomingData, fulfilledTimeStamp} = useGetUpcomingScenarioQuery(
    {scenarioSessionId: scenarioSessionId || ''},
    {
      skip: !scenarioSessionId || !pathId,
      pollingInterval,
    },
  );

  const [getReviewThreadComments] = useLazyGetThreadsQuery();
  const [getReactionsCount] = useLazyGetReactionsCountQuery();

  const {showToast} = useToast();

  useEffect(() => {
    if (
      upcomingData?.currentSession?.eventStatus ===
        SimulationEventStatus.COMPLETED ||
      nextSimulationPollingAttemptsRef.current >= RETRY_COUNT_LIMIT
    ) {
      setPollingInterval(0);
    } else {
      nextSimulationPollingAttemptsRef.current += 1;
    }
  }, [upcomingData, fulfilledTimeStamp]);

  useEffect(() => {
    setPollingInterval(RETRY_DELAY);
    nextSimulationPollingAttemptsRef.current = 0;
  }, [scenarioSessionId]);

  useEffect(() => {
    if (simulationDetails?.details?.summary?.errorMessage) {
      showToast(simulationDetails.details.summary.errorMessage, 'error');
    }
  }, [showToast, simulationDetails?.details?.summary?.errorMessage]);

  useEffect(() => {
    const fetchReviewThreadComments = async () => {
      if (!reviewId) return;
      if (!isPrivate) {
        setHideReviewDetails(false);
        return;
      }
      try {
        const threads = await getReviewThreadComments({
          reviewId: reviewId,
          offset: 0,
          limit: 1,
        });
        if (threads.data && threads.data.data.length === 0) {
          const reactionsCount = await getReactionsCount(reviewId);
          if (
            reactionsCount.data &&
            Object.keys(reactionsCount.data.reactions).length === 0
          ) {
            setHideReviewDetails(true);
          } else {
            setHideReviewDetails(false);
          }
        } else {
          setHideReviewDetails(false);
        }
      } catch (error) {
        console.error(error);
      }
    };
    fetchReviewThreadComments();
  }, [isPrivate, reviewId, getReviewThreadComments, getReactionsCount]);

  const upcomingScenario = upcomingData?.upcomingScenario;
  const currentSession = upcomingData?.currentSession;
  const hasUpcoming = !!upcomingScenario;
  const isCurrentSessionCompleted =
    currentSession?.scenarioPathSessionItemStatus ===
    SessionItemStatus.COMPLETED;
  const canRetryCurrent =
    !!currentSession?.scenarioPathSessionItemId && !isCurrentSessionCompleted;
  const isPathCompleted = !!currentSession?.isScenarioPathSessionCompleted;
  const isEventCompleted =
    currentSession?.eventStatus === SimulationEventStatus.COMPLETED;

  const {startSimulation, isCreatingRoom: isStartingSimulation} =
    useStartSimulation();
  const scrollViewRef = useRef<KeyboardAwareScrollView>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSimulationDetailsWithRetry = async (
    currentRetryCount: number = 0,
  ) => {
    const sessionId = scenarioSessionId;
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

  const handleBack = () => {
    if (pathId) {
      // Navigate back to the correct detail screen based on context type
      // Cases go to CaseDetails, Tracks go to SimulationPathDetails
      if (isCase) {
        navigation.reset({
          index: 0,
          routes: [
            {
              name: SCREEN_NAMES.CASE_DETAILS,
              params: {caseId: pathId},
            },
          ],
        });
      } else {
        navigation.reset({
          index: 0,
          routes: [
            {
              name: SCREEN_NAMES.SIMULATION_PATH_DETAILS,
              params: {pathId},
            },
          ],
        });
      }
      return;
    }

    if (fromLogs) {
      navigation.goBack();
      return;
    }

    navigateToLearnTab(navigation);
  };

  const handleFeedbackAndNavigate = () => {
    const currentTime = Date.now();
    const timeElapsed = currentTime - mountTime;

    if (timeElapsed >= FEEDBACK_THRESHOLD && !simulationDetails?.hasFeedback) {
      setIsFeedbackPopupVisible(true);
      return true;
    }
    handleBack();
    return true;
  };

  useHardwareBackPressHandler(handleFeedbackAndNavigate);

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
    handleBack();
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

  useEffect(() => {
    if (simulationDetails?.reviewId) {
      setReviewId(simulationDetails.reviewId);
      if (simulationDetails.reviewStatus === ReviewStatus.IN_REVIEW) {
        setIsPrivate(false);
      } else if (simulationDetails.reviewStatus === ReviewStatus.HIDDEN) {
        setIsPrivate(true);
      }
    }
  }, [simulationDetails?.reviewId, simulationDetails?.reviewStatus]);

  const hideFeedbackPopup = () => {
    setIsFeedbackPopupVisible(false);
  };

  const handleSubmit = () => {
    setIsFeedbackPopupVisible(true);
  };

  const handleViewReview = () => {
    navigation.navigate(SCREEN_NAMES.REVIEW_DETAILS, {
      reviewId: reviewId || '',
      isPrivate,
    });
  };

  const handlePrivacyToggle = async (isPrivateValue: boolean) => {
    if (isPrivateValue === isPrivate) {
      return;
    }

    setIsPrivate(isPrivateValue);

    if (!scenarioSessionId) return;

    try {
      if (isPrivateValue) {
        // User wants to keep it private (HIDDEN)
        if (reviewId) {
          await updateReviewStatus({
            reviewId,
            status: {status: ReviewStatus.HIDDEN},
          }).unwrap();
          showToast(t('SimulationFeedback.privacyUpdated'), 'success');
        }
      } else {
        // User wants to share for review (IN_REVIEW)
        if (reviewId) {
          // Update existing review status
          await updateReviewStatus({
            reviewId,
            status: {status: ReviewStatus.IN_REVIEW},
          }).unwrap();
          showToast(t('SimulationFeedback.sharedForReview'), 'success');
        } else {
          // Create new review
          const response = await createReview({
            scenarioSessionId: scenarioSessionId,
          }).unwrap();
          setReviewId(response.id);
          showToast(t('SimulationFeedback.sharedForReview'), 'success');
        }
      }
    } catch (error) {
      showToast(t('Errors.updatePrivacy'), 'error');
      // Revert the toggle state on error
      setIsPrivate(!isPrivateValue);
    }
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

  const handleTabChange = (tabIndex: number) => {
    setActiveTab(tabIndex);
  };

  const handleRetrySimulation = () => {
    const current = currentSession;
    if (!current || !current.scenarioId || !current.scenarioPathSessionItemId) {
      return;
    }

    startSimulation(
      current.scenarioId,
      current.scenarioPathSessionItemId,
      pathId,
    );
  };

  const handleNextSimulation = () => {
    const next = upcomingScenario;
    if (next && next.scenarioPathSessionItemId && next.id) {
      startSimulation(next.id, next.scenarioPathSessionItemId, pathId);
    }
  };

  const renderButtonContainer = () => {
    // Path simulations: show Finish / Retry / Next
    if (pathId) {
      if (!isEventCompleted) {
        return null;
      }
      // Path completed: show a single Finish button
      if (isPathCompleted) {
        return (
          <View style={styles.buttonContainer}>
            <PrimaryButton
              label={t('Common.finish')}
              onPress={handleFeedbackAndNavigate}
              customContainerStyle={styles.submitButton}
            />
          </View>
        );
      }

      return (
        <View style={styles.buttonContainer}>
          <View style={styles.pathNavigationContainer}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={handleFeedbackAndNavigate}
              activeOpacity={0.7}>
              <Text style={styles.backButtonText}>{t('Common.back')}</Text>
            </TouchableOpacity>
            {/* Show either Retry or Next, but never both */}
            {!hasUpcoming && canRetryCurrent && (
              <PrimaryButton
                label={t('CallSummaryProgress.retry')}
                onPress={handleRetrySimulation}
                customContainerStyle={styles.retryButton}
                isLoading={isStartingSimulation}
              />
            )}
            {isCurrentSessionCompleted && hasUpcoming && (
              <PrimaryButton
                label={t('Common.next')}
                onPress={handleNextSimulation}
                customContainerStyle={styles.nextButton}
                isLoading={isStartingSimulation}
              />
            )}
          </View>
        </View>
      );
    }

    // For normal simulations, show "Try Another" button
    if (!fromLogs) {
      return (
        <View style={styles.buttonContainer}>
          <PrimaryButton
            label={t('SimulationFeedback.tryAnother')}
            onPress={handleSubmit}
            customContainerStyle={styles.submitButton}
          />
        </View>
      );
    }
    return null;
  };

  const renderTitle = () => {
    const showSummary = activeTab === 0;
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
  const hasScenarioMessagesPermission = permissions?.includes(
    USER_PERMISSIONS.VIEW_SESSION_SCENARIO_MESSAGES,
  );

  const renderTabContent = () => {
    if (!hasScenarioMessagesPermission) {
      return null;
    }

    switch (activeTab) {
      case 0: // Summary
        return (
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
                <SimulationSummary data={simulationDetails ?? null} />
                {isEventCompleted && (
                  <>
                    {/* Transition message section */}
                    {(currentSession?.transitionMessageTitle ||
                      currentSession?.transitionMessageContent) && (
                      <View style={styles.transitionMessageContainer}>
                        {currentSession?.transitionMessageTitle && (
                          <Text style={styles.transitionMessageTitle}>
                            {currentSession.transitionMessageTitle}
                          </Text>
                        )}
                        {currentSession?.transitionMessageContent && (
                          <Text style={styles.transitionMessageContent}>
                            {currentSession.transitionMessageContent}
                          </Text>
                        )}
                      </View>
                    )}
                    {!isPathCompleted && !hasUpcoming && canRetryCurrent && (
                      <>
                        <Text style={styles.transitionMessageTitle}>
                          {t('SimulationFeedback.almostThereTitle')}
                        </Text>
                        <Text style={styles.transitionMessageContent}>
                          {t('SimulationFeedback.almostThereDescription')}
                        </Text>
                      </>
                    )}
                    {isCurrentSessionCompleted && !!upcomingScenario && (
                      <UpNextSimulationCard upNext={upcomingScenario} />
                    )}
                  </>
                )}
                {simulationDetails && renderButtonContainer()}
              </>
            )}
          </KeyboardAwareScrollView>
        );

      // TODO: Change the index of  Ask AI and Transcription after all the tabs are enabled
      // case 1: // Ask AI
      //   return <AskAI />;

      case 1: // Transcription
        if (scenarioSessionId) {
          return (
            <>
              <SimulationTranscript
                sessionId={scenarioSessionId}
                startedAt={simulationDetails?.startedAt}
                // currentTime={currentPlaybackTime}
                // onSeek={setSeekTime}
                agentName={simulationDetails?.scenario?.metadata?.name}
              />
              <View style={styles.privacyToggleContainer}>
                <PrivacyToggle
                  isPrivate={isPrivate}
                  onToggle={handlePrivacyToggle}
                />
              </View>
            </>
          );
        }
        return null;

      case 3: // Checklist
        return (
          <View style={styles.checklistContainer}>
            <SessionChecklist
              items={[
                // TODO: Replace with actual checklist items
                {
                  id: '1',
                  name: 'Item 1',
                  completed: true,
                },
                {
                  id: '2',
                  name: 'Item 2',
                  completed: true,
                },
                {
                  id: '3',
                  name: 'Item 3',
                  completed: false,
                },
              ]}
            />
          </View>
        );

      case 4: // Skills - TODO: Remove dummy data after API is implemented
        return (
          <SessionSkills
            skillCoverage={[
              {name: 'Learning', percentage: 60, color: colors.ds.blue[300]},
              {name: 'Support', percentage: 90, color: colors.ds.green[400]},
              {name: 'Standards', percentage: 40, color: colors.ds.amber[400]},
            ]}
            emotionalMovementDatasets={[
              {
                data: [
                  {x: 0, y: 1},
                  {x: 55, y: 1.292},
                  {x: 70, y: 3},
                  {x: 110, y: 3.5},
                  {x: 130, y: 5},
                  {x: 140, y: 5},
                  {x: 175, y: 4},
                  {x: 185, y: 3},
                  {x: 190, y: 5.5},
                  {x: 200, y: 4.7},
                  {x: 210, y: 6.5},
                  {x: 220, y: 6},
                  {x: 230, y: 6.5},
                  {x: 250, y: 2},
                  {x: 260, y: 7.5},
                  {x: 265, y: 4},
                  {x: 270, y: 8},
                  {x: 290, y: 3},
                  {x: 290, y: 2},
                  {x: 315, y: 3.21},
                  {x: 340, y: 3.33},
                ],
                color: opacity => `rgba(102, 187, 106, 1)`,
                strokeWidth: 2,
              },
            ]}
          />
        );

      case 5: // Reflection
        return <Reflection />;

      default:
        return null;
    }
  };

  // TODO: Uncomment the tabs after all the tabs are enabled
  const tabs = useMemo(
    () => [
      {
        key: 'summary',
        title: t('SimulationFeedback.tabs.summary'),
      },
      // {
      //   key: 'askAI',
      //   title: t('SimulationFeedback.tabs.askAI'),
      // },
      {
        key: 'transcription',
        title: t('SimulationFeedback.tabs.transcription'),
      },
      // {
      //   key: 'checklist',
      //   title: t('SimulationFeedback.tabs.checklist'),
      // },
      // {
      //   key: 'skills',
      //   title: t('SimulationFeedback.tabs.skills'),
      // },
      // {
      //   key: 'reflection',
      //   title: t('SimulationFeedback.tabs.reflection'),
      // },
    ],
    [t],
  );

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
              onPress={handleFeedbackAndNavigate}
              style={styles.backArrowButton}>
              <LeftArrowIcon color={colors.black} />
            </TouchableOpacity>
          )}
          <View style={globalStyles.column}>
            {hasScenarioMessagesPermission && (
              <View style={!fromLogs && styles.titleExtraPadding}>
                {renderTitle()}
                {fromLogs && simulationDetails?.metadata?.sessionName && (
                  <Text style={styles.subTitle}>
                    {simulationDetails.metadata.sessionName}
                  </Text>
                )}
              </View>
            )}
          </View>
          {!!reviewId && activeTab === 2 && !hideReviewDetails && (
            <TouchableOpacity
              onPress={handleViewReview}
              style={styles.reviewIconButton}
              activeOpacity={0.7}>
              <CommentIcon width={20} height={20} color={colors.black} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      {hasScenarioMessagesPermission && (
        <View style={styles.tabsContainer}>
          <CustomTabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        </View>
      )}
      {renderTabContent()}
      <FeedbackPopup
        visible={isFeedbackPopupVisible}
        onClose={hideFeedbackPopup}
        onSubmit={submitFeedback}
        showChips={false}
        placeholder={t('SimulationFeedback.placeholderText')}
        customTitle={t('SimulationFeedback.questionText')}
      />
      {showScrollButton && !isSimulationDetailsLoading && activeTab === 0 && (
        <TouchableOpacity
          onPress={handleScrollToBottom}
          style={styles.scrollToBottomButton}>
          <ChevronDown width={14} height={14} color={colors.lightGray4} />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

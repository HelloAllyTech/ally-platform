import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {
  ActivityIndicator,
  SafeAreaView,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {TabBar, TabView} from 'react-native-tab-view';

import {CommentIcon, LeftArrowIcon} from '@/assets';
import {
  Button,
  CustomSwitch,
  FeedbackPopup,
  SessionRatingTrigger,
  useToast,
} from '@/components';
import {FeedbackSubmission, FeedbackValue} from '@/components/FeedbackPopup';
import {
  DEFAULT_FEEDBACK_TABS,
  getSimulationSummaryTabs,
  SCREEN_NAMES,
  SimulationSummaryTabKey,
  USER_PERMISSIONS,
} from '@/constants';
import {
  useAppNavigation,
  useHardwareBackPressHandler,
  useHideReviewDetails,
  useToggleReviewPrivacy,
} from '@/hooks';
import {RootStackScreenProps} from '@/navigation/types';
import {
  useAddSimulationFeedbackMutation,
  useLazyGetReactionsCountQuery,
  useLazyGetSimulationDetailsQuery,
} from '@/services';
import {useGetReviewByIdQuery} from '@/services/reviewsApi';
import {useLazyGetThreadsQuery} from '@/services/reviewThreadsApi';
import {useAppSelector} from '@/store/hooks';
import {colors, globalStyles} from '@/theme';
import {ExperienceMode, ReviewStatus, TranscriptFocusRequest} from '@/types';
import {
  formatDurationAsMMSS,
  isMinutesPassed,
  isShortSession,
  navigateToLearnTab,
} from '@/utils';

import {
  DebriefTab,
  EventChecklist,
  SummaryTab,
  TranscriptTab,
} from './components';
import {styles} from './styles';

const MAX_RETRY_ATTEMPTS = 7;
const RETRY_DELAY = 3500;

export const SimulationFeedbackScreen: React.FC<
  RootStackScreenProps<'SimulationFeedback'>
> = ({route}) => {
  const {fromLogs, scenarioSessionId, pathId, caseId} = route.params;
  const permissions = useAppSelector(state => state.user.permissions);
  const {t, i18n} = useTranslation();
  // Feedback text is generated server-side in this language; translations for a
  // newly selected language are produced asynchronously, so the poll loop below
  // must restart whenever it changes (see the effect on activeLanguageCode).
  const activeLanguageCode = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const insets = useSafeAreaInsets();

  // Every surface opens on Debrief — Ally's note is what the learner came
  // back for — so the screen looks the same whether it was reached from the
  // logs or straight off a session. Short sessions only get Session Review.
  const [activeTabKey, setActiveTabKey] = useState<string>(
    SimulationSummaryTabKey.DEBRIEF,
  );
  const [isFeedbackPopupVisible, setIsFeedbackPopupVisible] =
    useState<boolean>(false);
  const [existingFeedback, setExistingFeedback] = useState<FeedbackValue>({
    rating: 0,
    tags: [],
    comment: '',
  });
  // A "See this moment" chip both switches to the transcript and asks it to
  // scroll to that message. The counter makes each tap a distinct request, so
  // tapping the same chip again scrolls back to the moment after the learner
  // has scrolled away from it (web parity).
  const [momentRequest, setMomentRequest] =
    useState<TranscriptFocusRequest | null>(null);
  const momentRequestCountRef = useRef(0);
  const feedbackPopupSource = useRef<'auto' | 'leave' | 'manual'>('auto');
  const hasFeedbackSubmitted = useRef(false);
  const [reviewId, setReviewId] = useState<string>();

  const navigation = useAppNavigation();
  const [addSimulationFeedback] = useAddSimulationFeedbackMutation();
  const {showToast} = useToast();

  const {handleTogglePrivate} = useToggleReviewPrivacy(reviewId);

  const [retryLimitReached, setRetryLimitReached] = useState<boolean>(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [getSimulationDetails, {data: simulationDetails}] =
    useLazyGetSimulationDetailsQuery();

  const {data: reviewData} = useGetReviewByIdQuery(
    {reviewId: reviewId || ''},
    {
      skip: !reviewId,
    },
  );

  const shortSession = isShortSession(simulationDetails?.details?.callDuration);
  const isPrivate = reviewData?.reviewStatus === ReviewStatus.HIDDEN;

  // Which post-session tabs this roleplay shows. The backend sends this
  // already resolved; the fallback here only covers a response cached from
  // before these toggles existed.
  const feedbackTabs =
    simulationDetails?.scenario?.metadata?.feedbackTabs ??
    DEFAULT_FEEDBACK_TABS;

  // Both tabs off means the author wants no post-session evaluation surface at
  // all — the wholesale opt-out the retired `enableFeedback` master switch used
  // to express, now said by the two toggles themselves. Only the star rating
  // is left.
  const feedbackEnabled = feedbackTabs.debrief || feedbackTabs.transcript;

  // CHECKLIST-mode roleplays show this regardless of which tabs are on — it
  // used to live in a tab that always existed (Session Review) and lost that
  // guarantee when the tabs became independently toggleable, so it renders
  // here rather than inside any one of them.
  const isChecklistMode =
    simulationDetails?.scenario?.metadata?.experienceMode ===
    ExperienceMode.CHECKLIST;

  const {hideReviewDetails} = useHideReviewDetails({
    reviewId,
    isPrivate,
    useLazyThreadsQuery: useLazyGetThreadsQuery,
    useLazyReactionsQuery: useLazyGetReactionsCountQuery,
  });

  // Increments on every poll restart so stale in-flight retry chains (from a
  // previous language or focus) stop scheduling further fetches.
  const retryGenerationRef = useRef(0);

  const fetchSimulationDetailsWithRetry = useCallback(
    async (retryCount = 0, generation = retryGenerationRef.current) => {
      if (!scenarioSessionId || generation !== retryGenerationRef.current) {
        return;
      }

      const scheduleRetry = () => {
        if (generation !== retryGenerationRef.current) {
          return;
        }
        if (retryCount < MAX_RETRY_ATTEMPTS) {
          retryTimeoutRef.current = setTimeout(() => {
            fetchSimulationDetailsWithRetry(retryCount + 1, generation);
          }, RETRY_DELAY);
        } else {
          setRetryLimitReached(true);
        }
      };

      try {
        const response = await getSimulationDetails({
          id: scenarioSessionId,
        }).unwrap();

        // Stop retrying once the feedback lands, or once we can see the
        // roleplay shows no post-session surface at all (both tabs off) —
        // there is nothing being generated to wait for.
        const tabs = response?.scenario?.metadata?.feedbackTabs;
        if (
          (tabs && !tabs.debrief && !tabs.transcript) ||
          response?.details?.summary?.feedback
        ) {
          return;
        }

        scheduleRetry();
      } catch (error) {
        scheduleRetry();
      }
    },
    [scenarioSessionId, getSimulationDetails],
  );

  const restartFeedbackPolling = useCallback(() => {
    retryGenerationRef.current += 1;
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    setRetryLimitReached(false);
    fetchSimulationDetailsWithRetry(0, retryGenerationRef.current);
  }, [fetchSimulationDetailsWithRetry]);

  // Runs on mount and again whenever the UI language changes: the backend
  // returns the session without `feedback` while the translated copy is still
  // generating, so the poll loop must restart to pick it up (web parity —
  // useSimulationSummaryPolling keys its effect on the language the same way).
  useEffect(() => {
    restartFeedbackPolling();
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [activeLanguageCode, restartFeedbackPolling]);

  useEffect(() => {
    if (simulationDetails?.reviewId) {
      setReviewId(simulationDetails.reviewId);
    }
  }, [simulationDetails?.reviewId]);

  // On first simulationDetails load: fetch existing feedback OR auto-open popup
  const hasHandledFeedbackInit = useRef(false);
  useEffect(() => {
    if (!simulationDetails || hasHandledFeedbackInit.current) {
      return;
    }
    hasHandledFeedbackInit.current = true;

    if (simulationDetails.hasFeedback && scenarioSessionId) {
      hasFeedbackSubmitted.current = true;
      const inlineFeedback = simulationDetails.sessionFeedback;
      if (inlineFeedback) {
        setExistingFeedback({
          rating: inlineFeedback.rating ?? 0,
          tags: inlineFeedback.tags ?? [],
          comment: inlineFeedback.feedback ?? '',
        });
      }
    } else if (!fromLogs) {
      feedbackPopupSource.current = 'auto';
      setIsFeedbackPopupVisible(true);
    }
  }, [fromLogs, simulationDetails, scenarioSessionId]);

  // Refetch simulation details on screen focus to pick up review changes.
  // Restarting the poll loop (rather than a one-shot fetch) also recovers
  // feedback whose translation was still generating when the user left.
  const isFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      if (scenarioSessionId) {
        restartFeedbackPolling();
      }
    }, [scenarioSessionId, restartFeedbackPolling]),
  );

  const handleBack = useCallback(() => {
    if (pathId || caseId) {
      navigation.reset({
        index: 0,
        routes: [
          {
            name: pathId
              ? SCREEN_NAMES.SIMULATION_PATH_DETAILS
              : SCREEN_NAMES.CASE_DETAILS,
            params: pathId ? {pathId: pathId} : {caseId: caseId},
          },
        ],
      });
      return;
    }

    if (fromLogs) {
      navigation.goBack();
      return;
    }

    navigateToLearnTab(navigation);
  }, [pathId, caseId, fromLogs, navigation]);

  const hideFeedbackPopup = useCallback(() => {
    const source = feedbackPopupSource.current;
    setIsFeedbackPopupVisible(false);
    if (!hasFeedbackSubmitted.current && source !== 'manual') {
      setExistingFeedback(prev => ({...prev, rating: 0}));
    }
    if (source === 'leave') {
      handleBack();
    }
  }, [handleBack]);

  const handleFeedbackAndNavigate = useCallback(() => {
    if (isFeedbackPopupVisible) {
      if (feedbackPopupSource.current === 'leave') {
        hideFeedbackPopup();
      } else {
        setIsFeedbackPopupVisible(false);
      }
      return true;
    }
    if (
      !fromLogs &&
      !hasFeedbackSubmitted.current &&
      !simulationDetails?.hasFeedback
    ) {
      feedbackPopupSource.current = 'leave';
      setIsFeedbackPopupVisible(true);
      return true;
    }
    handleBack();
    return true;
  }, [
    isFeedbackPopupVisible,
    fromLogs,
    simulationDetails?.hasFeedback,
    handleBack,
    hideFeedbackPopup,
  ]);

  useHardwareBackPressHandler(handleFeedbackAndNavigate);

  const submitFeedback = async ({
    rating,
    comment,
    tags,
  }: FeedbackSubmission) => {
    if (rating === 0) return;
    const source = feedbackPopupSource.current;
    setIsFeedbackPopupVisible(false);
    hasFeedbackSubmitted.current = true;
    setExistingFeedback({rating, tags, comment});
    try {
      const response = await addSimulationFeedback({
        scenarioSessionId: scenarioSessionId?.toString() || '',
        rating,
        comment,
        tags,
      });
      if (response.data) {
        showToast(t('callFeedback.submit'), 'success');
      } else {
        showToast(t('callFeedback.failSubmitFeedback'), 'error');
      }
    } catch (error) {
      showToast(t('callFeedback.failSubmitFeedback'), 'error');
      hideFeedbackPopup();
    }
    // When AI feedback is disabled, the rating popup is the only surface, so
    // submitting it returns the user to the list (mirrors the dismiss path).
    if (source === 'leave' || !feedbackEnabled) {
      handleBack();
    }
  };

  const handleSubmit = () => {
    setIsFeedbackPopupVisible(true);
  };

  const handleRatingSelect = (rating: number) => {
    feedbackPopupSource.current = 'manual';
    setExistingFeedback(prev => ({...prev, rating}));
    setIsFeedbackPopupVisible(true);
  };

  const layout = useWindowDimensions();

  const handleViewReview = () => {
    navigation.navigate(SCREEN_NAMES.REVIEW_DETAILS, {
      reviewId: reviewId || '',
      isPrivate,
    });
  };

  const handleShareSimulation = () => {
    const scenarioData = {
      coverImageUrl: simulationDetails?.scenario?.coverImageUrl,
      coverVideoUrl: simulationDetails?.scenario?.coverVideoUrl,
      title: simulationDetails?.scenario?.title || '',
      description: simulationDetails?.scenario?.description || '',
      createdAt: simulationDetails?.createdAt || '',
      duration: formatDurationAsMMSS(
        simulationDetails?.startedAt,
        simulationDetails?.endedAt,
      ),
    };
    navigation.navigate(SCREEN_NAMES.SHARE_SIMULATION, {
      reviewId: reviewId || '',
      scenarioSessionId: scenarioSessionId || '',
      scenarioData: scenarioData,
      note: reviewData?.note,
    });
  };

  const renderTryAnotherSimulation = () => {
    return (
      <Button
        label={t('postSim.common.tryAnother')}
        onPress={handleSubmit}
        customContainerStyle={styles.tryAnotherSimulationButton}
      />
    );
  };

  const renderTitle = () => {
    return (
      <View style={styles.titleContainer}>
        <View style={styles.titleTopRow}>
          <Text style={styles.title}>
            {t('review.tabs.simulation')}{' '}
            <Text style={styles.titleItalic}>
              {fromLogs
                ? t('callSummary.header.subtitle')
                : t('simulationPage.endDialog.titleNormal')}
            </Text>
          </Text>

          {feedbackEnabled && !shortSession && (
            <View style={styles.switchContainer}>
              <Text style={styles.switchLabel}>
                {t('learn.scenario.share')}
              </Text>
              <CustomSwitch
                value={!!reviewId && !isPrivate}
                onToggle={isEnabled => {
                  if (
                    isEnabled &&
                    (!reviewId ||
                      (reviewData?.createdAt &&
                        !isMinutesPassed(reviewData.createdAt)))
                  ) {
                    handleShareSimulation();
                  } else if (reviewId) {
                    handleTogglePrivate(isEnabled);
                  }
                }}
              />
            </View>
          )}
        </View>

        {
          <SessionRatingTrigger
            value={existingFeedback.rating ?? 0}
            onSelect={handleRatingSelect}
            size="sm"
          />
        }
      </View>
    );
  };
  const hasScenarioMessagesPermission = permissions?.includes(
    USER_PERMISSIONS.VIEW_SESSION_SCENARIO_MESSAGES,
  );
  const hasSimulationReviewPermission = permissions?.includes(
    USER_PERMISSIONS.VIEW_SIMULATION_REVIEW,
  );

  const tabs = useMemo(
    () =>
      getSimulationSummaryTabs(t, {
        shortSession,
        feedbackTabs,
      }),
    [t, shortSession, feedbackTabs],
  );

  const tabIndex = useMemo(() => {
    const idx = tabs.findIndex(tab => tab.key === activeTabKey);
    return idx >= 0 ? idx : 0;
  }, [tabs, activeTabKey]);

  // Debrief is the default landing tab, but a roleplay can switch it off (or
  // any other currently-selected tab) — in which case fall through to
  // whichever tab is actually first (web parity).
  useEffect(() => {
    if (!tabs.length) {
      return;
    }
    if (!tabs.some(tab => tab.key === activeTabKey)) {
      setActiveTabKey(tabs[0].key);
    }
  }, [tabs, activeTabKey]);

  const handleTabChange = useCallback(
    (index: number) => {
      setActiveTabKey(tabs[index]?.key ?? SimulationSummaryTabKey.DEBRIEF);
    },
    [tabs],
  );

  const handleOpenMoment = useCallback((messageId: string) => {
    momentRequestCountRef.current += 1;
    setMomentRequest({messageId, requestId: momentRequestCountRef.current});
    setActiveTabKey(SimulationSummaryTabKey.TRANSCRIPTION);
  }, []);

  const renderScene = useCallback(
    ({route: sceneRoute}: {route: {key: string}}) => {
      if (!hasScenarioMessagesPermission || !scenarioSessionId) {
        return null;
      }
      switch (sceneRoute.key) {
        case SimulationSummaryTabKey.SUMMARY:
          return (
            <SummaryTab
              simulationDetails={simulationDetails ?? null}
              retryLimitReached={retryLimitReached}
            />
          );
        case SimulationSummaryTabKey.DEBRIEF:
          return (
            <DebriefTab
              scenarioSessionId={scenarioSessionId || ''}
              simulationDetails={simulationDetails ?? null}
              retryLimitReached={retryLimitReached}
              // Opened from Logs the debrief is being read back, not received:
              // no reply thread, and no chance of an admin typing into the
              // learner's own conversation with Ally.
              readOnly={Boolean(fromLogs)}
              // Anchors only become chips when there is a transcript tab to
              // switch to; otherwise they render as plain prose.
              onOpenMoment={
                feedbackTabs.transcript ? handleOpenMoment : undefined
              }
            />
          );
        case SimulationSummaryTabKey.TRANSCRIPTION:
          return (
            <TranscriptTab
              scenarioSessionId={scenarioSessionId}
              startedAt={simulationDetails?.startedAt}
              agentName={simulationDetails?.scenario?.metadata?.name}
              focusMessage={momentRequest}
            />
          );
        default:
          return null;
      }
    },
    [
      hasScenarioMessagesPermission,
      scenarioSessionId,
      simulationDetails,
      retryLimitReached,
      fromLogs,
      feedbackTabs,
      handleOpenMoment,
      momentRequest,
    ],
  );

  const renderTabBar = useCallback(
    (props: Parameters<typeof TabBar>[0]) => (
      <TabBar
        {...props}
        scrollEnabled
        indicatorStyle={styles.tabBarIndicator}
        style={styles.tabBar}
        tabStyle={styles.tabBarTab}
        activeColor={colors.ds.theme.primary}
        inactiveColor={colors.ds.typography.lowEmphasis}
      />
    ),
    [],
  );

  return (
    <SafeAreaView
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.titleSection}>
        <View style={styles.titleRow}>
          <TouchableOpacity
            onPress={handleFeedbackAndNavigate}
            style={styles.backArrowButton}>
            <LeftArrowIcon color={colors.black} />
          </TouchableOpacity>
          <View style={[globalStyles.fillCol]}>
            {hasScenarioMessagesPermission && renderTitle()}
          </View>
        </View>
      </View>
      {feedbackEnabled &&
        hasScenarioMessagesPermission &&
        isChecklistMode &&
        !shortSession &&
        !!scenarioSessionId && (
          <View style={styles.eventChecklistContainer}>
            <EventChecklist scenarioSessionId={scenarioSessionId} />
          </View>
        )}
      {feedbackEnabled && hasScenarioMessagesPermission && (
        <View style={[styles.tabsContainer, styles.tabViewWrapper]}>
          <TabView
            navigationState={{index: tabIndex, routes: tabs}}
            renderScene={renderScene}
            renderTabBar={renderTabBar}
            onIndexChange={handleTabChange}
            initialLayout={{width: layout.width}}
            lazy
            renderLazyPlaceholder={() => (
              <View style={styles.lazyPlaceholder}>
                <ActivityIndicator
                  size="large"
                  color={colors.ds.theme.primary}
                />
              </View>
            )}
            swipeEnabled
            commonOptions={{labelStyle: styles.tabBarLabel}}
          />
        </View>
      )}
      {feedbackEnabled &&
        !!reviewId &&
        activeTabKey !== SimulationSummaryTabKey.DEBRIEF &&
        !hideReviewDetails &&
        hasSimulationReviewPermission && (
          <TouchableOpacity
            onPress={handleViewReview}
            style={styles.reviewIconButton}
            activeOpacity={0.7}>
            <CommentIcon width={20} height={20} color={colors.black} />
          </TouchableOpacity>
        )}
      {feedbackEnabled &&
        activeTabKey !== SimulationSummaryTabKey.DEBRIEF &&
        !fromLogs &&
        !pathId &&
        !caseId &&
        simulationDetails &&
        renderTryAnotherSimulation()}
      <FeedbackPopup
        visible={isFeedbackPopupVisible}
        onClose={feedbackEnabled ? hideFeedbackPopup : handleBack}
        onSubmit={submitFeedback}
        showChips={false}
        placeholder={t('callFeedback.placeholderText')}
        customTitle={t('callFeedback.questionText')}
        initialFeedback={existingFeedback}
      />
    </SafeAreaView>
  );
};

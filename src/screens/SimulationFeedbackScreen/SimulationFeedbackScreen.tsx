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
import {Button, CustomSwitch, FeedbackPopup, useToast} from '@/components';
import {
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
import {ReviewStatus} from '@/types';
import {
  formatDurationAsMMSS,
  isMinutesPassed,
  isShortSession,
  navigateToLearnTab,
} from '@/utils';

import {
  AskAI,
  Reflection,
  SessionSkills,
  SummaryTab,
  TranscriptTab,
  UpNext,
} from './components';
import {styles} from './styles';

const MAX_RETRY_ATTEMPTS = 7;
const RETRY_DELAY = 3500;

export const SimulationFeedbackScreen: React.FC<
  RootStackScreenProps<'SimulationFeedback'>
> = ({route}) => {
  const {fromLogs, scenarioSessionId, pathId, caseId, languageId} =
    route.params;
  const permissions = useAppSelector(state => state.user.permissions);
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();

  const [activeTabKey, setActiveTabKey] = useState<string>(
    SimulationSummaryTabKey.SUMMARY,
  );
  const [isFeedbackPopupVisible, setIsFeedbackPopupVisible] =
    useState<boolean>(false);
  const [reviewId, setReviewId] = useState<string>();

  const navigation = useAppNavigation();
  const [addSimulationFeedback] = useAddSimulationFeedbackMutation();
  const {showToast} = useToast();

  const {handleTogglePrivate} = useToggleReviewPrivacy(reviewId);

  const [retryLimitReached, setRetryLimitReached] = useState<boolean>(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [getSimulationDetails, {data: simulationDetails}] =
    useLazyGetSimulationDetailsQuery();
  console.log(
    '🚀 ~ SimulationFeedbackScreen ~ simulationDetails:',
    simulationDetails?.details,
  );

  const {data: reviewData} = useGetReviewByIdQuery(
    {reviewId: reviewId || ''},
    {
      skip: !reviewId,
    },
  );

  const shortSession = isShortSession(simulationDetails?.details?.callDuration);
  const isPrivate = reviewData?.reviewStatus === ReviewStatus.HIDDEN;

  const {hideReviewDetails} = useHideReviewDetails({
    reviewId,
    isPrivate,
    useLazyThreadsQuery: useLazyGetThreadsQuery,
    useLazyReactionsQuery: useLazyGetReactionsCountQuery,
  });

  const fetchSimulationDetailsWithRetry = useCallback(
    async (retryCount = 0) => {
      if (!scenarioSessionId) {
        return;
      }
      try {
        const response = await getSimulationDetails({
          id: scenarioSessionId,
        }).unwrap();

        if (response?.details?.summary?.feedback) {
          return;
        }

        if (retryCount < MAX_RETRY_ATTEMPTS) {
          retryTimeoutRef.current = setTimeout(() => {
            fetchSimulationDetailsWithRetry(retryCount + 1);
          }, RETRY_DELAY);
        } else {
          setRetryLimitReached(true);
        }
      } catch (error) {
        if (retryCount < MAX_RETRY_ATTEMPTS) {
          retryTimeoutRef.current = setTimeout(() => {
            fetchSimulationDetailsWithRetry(retryCount + 1);
          }, RETRY_DELAY);
        } else {
          setRetryLimitReached(true);
        }
      }
    },
    [scenarioSessionId, getSimulationDetails],
  );

  useEffect(() => {
    fetchSimulationDetailsWithRetry();
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [fetchSimulationDetailsWithRetry]);

  useEffect(() => {
    if (simulationDetails?.reviewId) {
      setReviewId(simulationDetails.reviewId);
    }
  }, [simulationDetails?.reviewId]);

  // Refetch simulation details on screen focus to pick up review changes
  const isFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      if (scenarioSessionId) {
        getSimulationDetails({id: scenarioSessionId});
      }
    }, [scenarioSessionId, getSimulationDetails]),
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

  const handleFeedbackAndNavigate = useCallback(() => {
    handleBack();
    return true;
  }, [handleBack]);

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

  const hideFeedbackPopup = () => {
    setIsFeedbackPopupVisible(false);
  };

  const handleSubmit = () => {
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
        label={t('SimulationFeedback.tryAnother')}
        onPress={handleSubmit}
        customContainerStyle={styles.tryAnotherSimulationButton}
      />
    );
  };

  const renderTitle = () => {
    return (
      <View style={styles.titleContainer}>
        <Text style={styles.title}>
          {t('SimulationFeedback.title')}{' '}
          <Text style={styles.titleItalic}>
            {fromLogs
              ? t('CallSummary.header.subtitle')
              : t('SimulationFeedback.titleEnded')}
          </Text>
        </Text>

        {!shortSession && (
          <View style={styles.switchContainer}>
            <Text style={styles.switchLabel}>
              {t('SimulationFeedback.share')}
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
        pathId,
        caseId,
        shortSession,
      }),
    [t, pathId, caseId, shortSession],
  );

  const tabIndex = useMemo(() => {
    const idx = tabs.findIndex(tab => tab.key === activeTabKey);
    return idx >= 0 ? idx : 0;
  }, [tabs, activeTabKey]);

  const handleTabChange = useCallback(
    (index: number) => {
      setActiveTabKey(tabs[index]?.key ?? SimulationSummaryTabKey.SUMMARY);
    },
    [tabs],
  );

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
        case SimulationSummaryTabKey.ASK_AI:
          return (
            <AskAI
              scenarioSessionId={scenarioSessionId || ''}
              clientName={simulationDetails?.scenario?.metadata?.name ?? ''}
            />
          );
        case SimulationSummaryTabKey.TRANSCRIPTION:
          return (
            <TranscriptTab
              scenarioSessionId={scenarioSessionId}
              startedAt={simulationDetails?.startedAt}
              agentName={simulationDetails?.scenario?.metadata?.name}
            />
          );
        case SimulationSummaryTabKey.SKILLS:
          return (
            <SessionSkills
              scenarioSessionId={scenarioSessionId}
              simulationDetails={simulationDetails}
              isActive={activeTabKey === SimulationSummaryTabKey.SKILLS}
            />
          );
        case SimulationSummaryTabKey.REFLECTION:
          return <Reflection scenarioSessionId={scenarioSessionId} />;
        case SimulationSummaryTabKey.UP_NEXT:
          return (
            <UpNext
              scenarioSessionId={scenarioSessionId}
              pathId={pathId}
              caseId={caseId}
              languageId={languageId}
              onFinish={handleFeedbackAndNavigate}
              onBack={handleFeedbackAndNavigate}
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
      pathId,
      caseId,
      handleFeedbackAndNavigate,
      languageId,
      activeTabKey,
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
      {hasScenarioMessagesPermission && (
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
      {!!reviewId &&
        activeTabKey !== SimulationSummaryTabKey.ASK_AI &&
        !hideReviewDetails &&
        hasSimulationReviewPermission && (
          <TouchableOpacity
            onPress={handleViewReview}
            style={styles.reviewIconButton}
            activeOpacity={0.7}>
            <CommentIcon width={20} height={20} color={colors.black} />
          </TouchableOpacity>
        )}
      {activeTabKey !== SimulationSummaryTabKey.ASK_AI &&
        !fromLogs &&
        !pathId &&
        !caseId &&
        simulationDetails &&
        renderTryAnotherSimulation()}
      <FeedbackPopup
        visible={isFeedbackPopupVisible}
        onClose={hideFeedbackPopup}
        onSubmit={submitFeedback}
        showChips={false}
        placeholder={t('SimulationFeedback.placeholderText')}
        customTitle={t('SimulationFeedback.questionText')}
      />
    </SafeAreaView>
  );
};

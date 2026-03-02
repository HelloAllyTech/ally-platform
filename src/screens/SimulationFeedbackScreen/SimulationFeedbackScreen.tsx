import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
import {FeedbackPopup, useToast} from '@/components';
import {
  getSimulationSummaryTabs,
  SCREEN_NAMES,
  SimulationSummaryTabKey,
  USER_PERMISSIONS,
} from '@/constants';
import {useAppNavigation, useHardwareBackPressHandler} from '@/hooks';
import {RootStackScreenProps} from '@/navigation/types';
import {
  useAddSimulationFeedbackMutation,
  useLazyGetReactionsCountQuery,
  useLazyGetSimulationDetailsQuery,
} from '@/services';
import {useLazyGetThreadsQuery} from '@/services/reviewThreadsApi';
import {useAppSelector} from '@/store/hooks';
import {colors, globalStyles} from '@/theme';
import {ReviewStatus} from '@/types';
import {navigateToLearnTab} from '@/utils';

import {
  AskAI,
  Reflection,
  SessionSkills,
  SummaryTab,
  TranscriptTab,
  UpNext,
} from './components';
import {styles} from './styles';

const MAX_RETRY_ATTEMPTS = 5;
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
  const [hideReviewDetails, setHideReviewDetails] = useState<boolean>(false);
  const [isPrivate, setIsPrivate] = useState<boolean>(true);

  const navigation = useAppNavigation();
  const [addSimulationFeedback] = useAddSimulationFeedbackMutation();
  const {showToast} = useToast();

  const [retryLimitReached, setRetryLimitReached] = useState<boolean>(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [getSimulationDetails, {data: simulationDetails}] =
    useLazyGetSimulationDetailsQuery();

  const [getReviewThreadComments] = useLazyGetThreadsQuery();
  const [getReactionsCount] = useLazyGetReactionsCountQuery();

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

  // Set reviewId and isPrivate from simulation details
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

  // Fetch review threads and reactions to determine if comment icon should be shown
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
        if (threads.data?.data?.length === 0) {
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

  const renderTitle = () => {
    return (
      <Text style={styles.title}>
        {t('SimulationFeedback.title')}{' '}
        <Text style={styles.titleItalic}>
          {fromLogs
            ? t('CallSummary.header.subtitle')
            : t('SimulationFeedback.titleEnded')}
        </Text>
      </Text>
    );
  };
  const hasScenarioMessagesPermission = permissions?.includes(
    USER_PERMISSIONS.VIEW_SESSION_SCENARIO_MESSAGES,
  );

  const tabs = useMemo(
    () =>
      getSimulationSummaryTabs(t, {
        pathId,
        caseId,
      }),
    [t, pathId, caseId],
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
          return <AskAI scenarioSessionId={scenarioSessionId || ''} />;
        case SimulationSummaryTabKey.TRANSCRIPTION:
          return (
            <TranscriptTab
              isPrivate={isPrivate}
              setIsPrivate={setIsPrivate}
              reviewId={reviewId}
              setReviewId={setReviewId}
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
      isPrivate,
      reviewId,
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
          <View style={globalStyles.column}>
            {hasScenarioMessagesPermission && renderTitle()}
          </View>
          {/* Comment icon for transcript tab */}
          {!!reviewId &&
            activeTabKey === SimulationSummaryTabKey.TRANSCRIPTION &&
            !hideReviewDetails && (
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

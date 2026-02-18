import React, {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {SafeAreaView, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {CommentIcon, LeftArrowIcon} from '@/assets';
import {CustomTabs, FeedbackPopup, useToast} from '@/components';
import {SCREEN_NAMES, USER_PERMISSIONS} from '@/constants';
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

import {AskAI, SummaryTab, TranscriptTab, UpNext} from './components';
import {styles} from './styles';

// Tab keys enum for better maintainability and type safety
enum TabKey {
  SUMMARY = 'SUMMARY',
  ASK_AI = 'ASK_AI',
  TRANSCRIPTION = 'TRANSCRIPTION',
  // CHECKLIST = 'CHECKLIST',
  // SKILLS = 'SKILLS',
  // REFLECTION = 'REFLECTION',
  UP_NEXT = 'UP_NEXT',
}

export const SimulationFeedbackScreen: React.FC<
  RootStackScreenProps<'SimulationFeedback'>
> = ({route}) => {
  const {fromLogs, scenarioSessionId, pathId, caseId, languageId} =
    route.params;
  const permissions = useAppSelector(state => state.user.permissions);
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<number>(0);
  const [isFeedbackPopupVisible, setIsFeedbackPopupVisible] =
    useState<boolean>(false);
  const [reviewId, setReviewId] = useState<string>();
  const [hideReviewDetails, setHideReviewDetails] = useState<boolean>(false);
  const [isPrivate, setIsPrivate] = useState<boolean>(true);

  const navigation = useAppNavigation();
  const [addSimulationFeedback] = useAddSimulationFeedbackMutation();
  const {showToast} = useToast();

  const [getSimulationDetails, {data: simulationDetails}] =
    useLazyGetSimulationDetailsQuery();

  const [getReviewThreadComments] = useLazyGetThreadsQuery();
  const [getReactionsCount] = useLazyGetReactionsCountQuery();

  // Fetch simulation details to get reviewId
  useEffect(() => {
    if (scenarioSessionId) {
      getSimulationDetails({id: scenarioSessionId});
    }
  }, [scenarioSessionId, getSimulationDetails]);

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

  const handleBack = () => {
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
  };

  const handleFeedbackAndNavigate = () => {
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

  const hideFeedbackPopup = () => {
    setIsFeedbackPopupVisible(false);
  };

  const handleSubmit = () => {
    setIsFeedbackPopupVisible(true);
  };

  const handleTabChange = (tabIndex: number) => {
    setActiveTab(tabIndex);
  };

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

  const renderTabContent = () => {
    if (!hasScenarioMessagesPermission) {
      return null;
    }

    // Get the current tab key based on index
    const currentTabKey = tabs[activeTab]?.key;

    switch (currentTabKey) {
      case TabKey.SUMMARY:
        return (
          <SummaryTab
            scenarioSessionId={scenarioSessionId}
            pathId={pathId}
            caseId={caseId}
            fromLogs={fromLogs}
            onTryAnother={handleSubmit}
          />
        );

      case TabKey.ASK_AI:
        return <AskAI />;

      case TabKey.TRANSCRIPTION:
        return (
          <TranscriptTab
            isPrivate={isPrivate}
            setIsPrivate={setIsPrivate}
            reviewId={reviewId}
            setReviewId={setReviewId}
            scenarioSessionId={scenarioSessionId}
          />
        );

      // case TabKey.CHECKLIST:
      //   return <ChecklistTab scenarioSessionId={scenarioSessionId} />;

      // case TabKey.SKILLS:
      //   return <SessionSkills scenarioSessionId={scenarioSessionId} />;

      // case TabKey.REFLECTION:
      //   return <Reflection />;

      case TabKey.UP_NEXT:
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
  };

  // Build tabs array using enum keys for type safety
  const tabs = useMemo(() => {
    const tabsList = [
      {
        key: TabKey.SUMMARY,
        title: t('SimulationFeedback.tabs.summary'),
      },
      // {
      //   key: TabKey.ASK_AI,
      //   title: t('SimulationFeedback.tabs.askAI'),
      // },
      {
        key: TabKey.TRANSCRIPTION,
        title: t('SimulationFeedback.tabs.transcription'),
      },
      // {
      //   key: TabKey.CHECKLIST,
      //   title: t('SimulationFeedback.tabs.checklist'),
      // },
      // {
      //   key: TabKey.SKILLS,
      //   title: t('SimulationFeedback.tabs.skills'),
      // },
      // {
      //   key: TabKey.REFLECTION,
      //   title: t('SimulationFeedback.tabs.reflection'),
      // },
    ];

    // Only show "Up Next" tab for paths and cases
    if (pathId || caseId) {
      tabsList.push({
        key: TabKey.UP_NEXT,
        title: t('SimulationFeedback.tabs.upNext'),
      });
    }

    return tabsList;
  }, [t, pathId, caseId]);

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
              </View>
            )}
          </View>
          {/* Comment icon for transcript tab */}
          {!!reviewId &&
            tabs[activeTab]?.key === TabKey.TRANSCRIPTION &&
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
        <View style={styles.tabsContainer}>
          <CustomTabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            activeTabTextColor={colors.ds.theme.primary}
            inactiveTabTextColor={colors.ds.typography.lowEmphasis}
            activeTabBorderColor={colors.ds.theme.primary}
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
    </SafeAreaView>
  );
};

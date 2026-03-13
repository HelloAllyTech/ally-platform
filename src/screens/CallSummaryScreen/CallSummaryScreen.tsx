import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  ActivityIndicator,
  StatusBar,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {SafeAreaView} from 'react-native-safe-area-context';
import {TabBar, TabView} from 'react-native-tab-view';

import {CommentIcon} from '@/assets';
import {Button, useToast} from '@/components';
import {ChatSummaryStatus, SCREEN_NAMES, USER_PERMISSIONS} from '@/constants';
import {
  useAppNavigation,
  useCallSummaryActions,
  useCallSummaryForm,
  useHardwareBackPressHandler,
  useSummaryState,
  useToggleReviewPrivacy,
  useTranslate,
} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {
  useLazyGetScribeReactionsCountQuery,
  useLazyGetScribeThreadsQuery,
} from '@/services';
import {useUpdateScribeReviewStatusMutation} from '@/services/scribeReviewsApi';
import {useGetSummaryFieldsQuery} from '@/services/settingsApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {selectCallInfo} from '@/store/slices/summarySlice';
import {colors} from '@/theme';
import {ReviewStatus} from '@/types';
import {
  formatDurationFromSeconds,
  getErrorDetails,
  isMinutesPassed,
  navigateToCallLogTab,
} from '@/utils';

import {
  AddNotesSection,
  CallSummaryDetails,
  CallTranscript,
  Header,
  SummaryGenerationProgress,
  SummaryModals,
  SummaryUnauthorized,
} from './components';
import {styles} from './styles';

const SUMMARY_TAB_KEY = 'summary';
const TRANSCRIPT_TAB_KEY = 'transcript';

export const CallSummaryScreen: React.FC<
  RootStackScreenProps<'CallSummary'>
> = ({route}) => {
  const {t} = useTranslate();
  const currentChat = useAppSelector(state => state.chat.currentChat);
  const callInfo = useAppSelector(selectCallInfo);
  const {permissions} = useAppSelector(state => state.user);
  const {hasChanges} = useCallSummaryForm();

  const callId = route.params?.callId;
  const fromLogs = route.params?.fromLogs;
  const chatId = callId || currentChat?.chatId;

  const navigation = useAppNavigation();
  const layout = useWindowDimensions();

  const {refetch: refetchSummaryFields} = useGetSummaryFieldsQuery();
  const [getScribeReviewThreadComments] = useLazyGetScribeThreadsQuery();
  const [getScribeReviewReactionsCount] = useLazyGetScribeReactionsCountQuery();

  useEffect(() => {
    refetchSummaryFields();
  }, [callId, refetchSummaryFields]);

  const {
    isLoading,
    refreshing,
    summaryData,
    summaryError,
    canShowSummary,
    activeModal,
    setActiveModal,
    isSummaryAvailable,
    handleRefresh,
    handleNoteChange,
    summaryStatus,
  } = useSummaryState(chatId, callId);

  const hasFeedbackAlready = Boolean(
    summaryData?.details?.callInfo?.isSummaryFeedbackAdded,
  );
  const isUnauthorized =
    summaryError && getErrorDetails(summaryError).status === 403;
  const showTranscriptTab =
    Boolean(callId) &&
    !isUnauthorized &&
    permissions?.includes(USER_PERMISSIONS.VIEW_MESSAGES);

  const isArchived = !!summaryData?.archivedAt;

  const dispatch = useAppDispatch();

  const {
    handleSummaryNameChange,
    isMenuVisible,
    hideMenu,
    showMenu,
    handleExport,
    handleArchive,
    handleDelete,
    handleGoBack,
    summaryName,
    setSummaryName,
    onAddSummaryFeedback,
  } = useCallSummaryActions({
    chatId: chatId || 0,
    name: callInfo.summaryName || '',
    isCallLogSummaryFlow: Boolean(callId),
  });

  const {showToast} = useToast();

  const scribeReviewId = summaryData?.reviewId ?? undefined;
  const isSharedForReview =
    !!scribeReviewId && summaryData?.reviewStatus !== ReviewStatus.HIDDEN;

  const hasSummaryFailed = summaryStatus === ChatSummaryStatus.FAILED;
  const hasEditFeedbackPermission = permissions?.includes(
    USER_PERMISSIONS.EDIT_SUMMARY_FEEDBACK,
  );

  const handleShareForReview = useCallback(() => {
    if (!callId || !summaryData?.details) return;
    const details = summaryData.details;
    navigation.navigate(SCREEN_NAMES.SHARE_CALL_LOG, {
      scribeSessionId: callId,
      reviewId: scribeReviewId,
      sessionData: {
        title:
          callInfo.summaryName || t('Review.card.sharedSimulationForReview'),
        createdAt: details.startTime || summaryData.createdAt || '',
        duration: formatDurationFromSeconds(details.callDuration ?? 0),
      },
      note: summaryData?.reviewNote || '',
    });
  }, [
    callId,
    summaryData,
    callInfo.summaryName,
    navigation,
    t,
    scribeReviewId,
  ]);

  const {handleTogglePrivate: handleToggleScribePrivate} =
    useToggleReviewPrivacy(scribeReviewId, useUpdateScribeReviewStatusMutation);

  const handleShareToggle = useCallback(
    (isEnabled: boolean) => {
      if (
        isEnabled &&
        (!scribeReviewId ||
          (summaryData?.reviewCreatedAt &&
            !isMinutesPassed(summaryData.reviewCreatedAt)))
      ) {
        handleShareForReview();
      } else if (scribeReviewId) {
        handleToggleScribePrivate(isEnabled).then(() => handleRefresh());
      }
    },
    [
      scribeReviewId,
      summaryData?.reviewCreatedAt,
      handleShareForReview,
      handleToggleScribePrivate,
      handleRefresh,
    ],
  );

  const isFirstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocusRef.current) {
        isFirstFocusRef.current = false;
        return;
      }
      handleRefresh();
    }, [handleRefresh]),
  );

  const [mountTime] = useState<number>(Date.now());
  const [isFeedbackPopupVisible, setIsFeedbackPopupVisible] =
    useState<boolean>(false);
  const [showArchiveConfirmation, setShowArchiveConfirmation] =
    useState<boolean>(false);
  const [actionType, setActionType] = useState<'archive' | 'unarchive' | null>(
    null,
  );
  const [hideReviewDetails, setHideReviewDetails] = useState<boolean>(true);

  useEffect(() => {
    const fetchReviewThreadComments = async () => {
      if (!scribeReviewId) return;
      if (summaryData?.reviewStatus !== ReviewStatus.HIDDEN) {
        setHideReviewDetails(false);
        return;
      }
      try {
        const threads = await getScribeReviewThreadComments({
          reviewId: scribeReviewId,
          offset: 0,
          limit: 1,
        });
        if (threads.data?.data?.length === 0) {
          const reactionsCount =
            await getScribeReviewReactionsCount(scribeReviewId);
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
  }, [
    scribeReviewId,
    getScribeReviewThreadComments,
    getScribeReviewReactionsCount,
    summaryData?.reviewStatus,
  ]);

  useEffect(() => {
    if (isArchived) {
      setActionType('unarchive');
    } else {
      setActionType('archive');
    }
  }, [isArchived]);

  useHardwareBackPressHandler(() => {
    onBackNavigation();
    return true;
  });

  const onBackNavigation = () => {
    const summaryGenerated = isSummaryAvailable && canShowSummary;
    if (!summaryGenerated) {
      handleGoBack();
      return;
    }
    const currentTime = Date.now();
    const timeElapsed = currentTime - mountTime;
    const thresholdMs = 30 * 1000;

    if (
      (timeElapsed >= thresholdMs || !fromLogs) &&
      !hasFeedbackAlready &&
      hasEditFeedbackPermission
    ) {
      setIsFeedbackPopupVisible(true);
      return;
    }

    handleGoBack();
  };

  const onSaveButtonPress = () => {
    if (!hasFeedbackAlready && hasEditFeedbackPermission) {
      setIsFeedbackPopupVisible(true);
    }
  };

  const handleBlur = () => {
    if (handleSummaryNameChange) {
      handleSummaryNameChange(summaryName || '');
    }
  };

  const onViewCallLogs = () => {
    dispatch(clearCurrentChat());
    navigateToCallLogTab(navigation);
  };

  const onSubmitSummaryFeedback = async (
    rating: number,
    feedback: {issues: string[]; comment: string},
  ) => {
    const response = await onAddSummaryFeedback(rating, feedback);
    if (response.data) {
      showToast(t('Success.submitFeedback'), 'success');
    } else {
      showToast(t('CallSummary.info.summaryFeedbackSubmittedFailed'), 'error');
    }
    setIsFeedbackPopupVisible(false);
    handleGoBack();
  };
  const handleViewReview = () => {
    navigation.navigate(SCREEN_NAMES.SCRIBE_REVIEW_DETAILS, {
      reviewId: scribeReviewId || '',
      isPrivate: summaryData?.reviewStatus === ReviewStatus.HIDDEN,
    });
  };

  const hasScribeReviewPermission = permissions?.includes(
    USER_PERMISSIONS.VIEW_SCRIBE_REVIEW,
  );

  const showSummaryButtonLoader =
    (isSummaryAvailable && !canShowSummary) || isLoading || refreshing;

  const summaryActionButtonText = useMemo(
    () =>
      isSummaryAvailable && !canShowSummary
        ? t('CallSummaryProgress.settingUpSummaryScreen')
        : hasSummaryFailed
          ? t('CallSummaryProgress.retry')
          : t('CallLogs.seeIfItIsReady'),
    [isSummaryAvailable, canShowSummary, hasSummaryFailed, t],
  );

  const renderSummaryButtons = () => {
    return (
      <View style={styles.summaryButtonsContainer}>
        {summaryStatus !== ChatSummaryStatus.NO_AUDIO && (
          <TouchableOpacity
            onPress={handleRefresh}
            style={[styles.seeIfReadyButton, styles.marginB8]}
            disabled={showSummaryButtonLoader}>
            {showSummaryButtonLoader && (
              <ActivityIndicator color={colors.azureBlue} />
            )}
            <Text style={styles.viewCallLogsButtonText}>
              {summaryActionButtonText}
            </Text>
          </TouchableOpacity>
        )}
        {!showSummaryButtonLoader && (
          <Button
            label={t('CallLogs.willCheckLater')}
            onPress={onViewCallLogs}
            customContainerStyle={[
              styles.viewCallLogsButton,
              summaryStatus === ChatSummaryStatus.NO_AUDIO &&
                styles.viewCallLogsButtonBorder,
            ]}
            customTextStyle={styles.viewCallLogsButtonText}
          />
        )}
      </View>
    );
  };

  const renderSummaryTab = () => {
    if (isUnauthorized) {
      return <SummaryUnauthorized onGoBack={handleGoBack} />;
    }

    if (isSummaryAvailable && canShowSummary) {
      const shouldShowSaveButton =
        (!callId || hasChanges) && !isFeedbackPopupVisible;
      return (
        <CallSummaryDetails
          isLoading={isLoading}
          onSubmit={onSaveButtonPress}
          showSaveButton={shouldShowSaveButton}
        />
      );
    }

    if (isLoading) {
      return (
        <View style={styles.spinnerContainer}>
          <ActivityIndicator color={colors.darkSlate} />
        </View>
      );
    }

    return (
      <>
        <KeyboardAwareScrollView
          style={styles.scrollView}
          nestedScrollEnabled
          extraScrollHeight={100}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          enableOnAndroid>
          <SummaryGenerationProgress summaryStatus={summaryStatus} />
          <AddNotesSection
            savedNotes={summaryData?.details?.callInfo?.notes || ''}
            onNoteChange={handleNoteChange}
          />
        </KeyboardAwareScrollView>
        {!isFeedbackPopupVisible && renderSummaryButtons()}
      </>
    );
  };

  const tabs = useMemo(() => {
    const result = [
      {key: SUMMARY_TAB_KEY, title: t('SimulationFeedback.tabs.sessionReview')},
    ];
    if (showTranscriptTab) {
      result.push({
        key: TRANSCRIPT_TAB_KEY,
        title: t('SimulationFeedback.tabs.annotatedTranscript'),
      });
    }
    return result;
  }, [showTranscriptTab, t]);

  const [tabIndex, setTabIndex] = useState(0);

  const renderScene = useCallback(
    ({route: sceneRoute}: {route: {key: string}}) => {
      switch (sceneRoute.key) {
        case SUMMARY_TAB_KEY:
          return renderSummaryTab();
        case TRANSCRIPT_TAB_KEY:
          return <CallTranscript chatId={chatId || 0} />;
        default:
          return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      chatId,
      isUnauthorized,
      isSummaryAvailable,
      canShowSummary,
      isLoading,
      isFeedbackPopupVisible,
      callId,
      hasChanges,
      summaryStatus,
      summaryData,
      showSummaryButtonLoader,
      summaryActionButtonText,
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
    <SafeAreaView style={styles.container}>
      <StatusBar />

      <SummaryModals
        activeModal={activeModal}
        setActiveModal={setActiveModal}
        handleDelete={handleDelete}
        handleBlur={handleBlur}
        editedName={summaryName}
        setEditedName={setSummaryName}
        isMenuVisible={isMenuVisible}
        hideMenu={hideMenu}
        handleExport={handleExport}
        actionType={actionType}
        setActionType={setActionType}
        showArchiveConfirmation={showArchiveConfirmation}
        setShowArchiveConfirmation={setShowArchiveConfirmation}
        onArchive={handleArchive}
        showExportOption={isSummaryAvailable}
        isSummaryFeedbackPopup={isFeedbackPopupVisible}
        hideSummaryFeedbackPopup={() => setIsFeedbackPopupVisible(false)}
        onSubmitSummaryFeedback={onSubmitSummaryFeedback}
      />

      <Header
        onBackPress={onBackNavigation}
        onMenuPress={showMenu}
        summaryName={summaryName}
        showShareSwitch={
          Boolean(callId) &&
          isSummaryAvailable &&
          summaryStatus === ChatSummaryStatus.SUCCESS
        }
        isSharedForReview={isSharedForReview}
        onShareToggle={handleShareToggle}
      />

      <View style={styles.tabsContainer}>
        <TabView
          navigationState={{index: tabIndex, routes: tabs}}
          renderScene={renderScene}
          renderTabBar={renderTabBar}
          onIndexChange={setTabIndex}
          initialLayout={{width: layout.width}}
          lazy
          renderLazyPlaceholder={() => (
            <View style={styles.lazyPlaceholder}>
              <ActivityIndicator size="large" color={colors.ds.theme.primary} />
            </View>
          )}
          swipeEnabled
          commonOptions={{labelStyle: styles.tabBarLabel}}
        />
      </View>
      {!!scribeReviewId && !hideReviewDetails && hasScribeReviewPermission && (
        <TouchableOpacity
          onPress={handleViewReview}
          style={styles.reviewIconButton}
          activeOpacity={0.7}>
          <CommentIcon width={20} height={20} color={colors.black} />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

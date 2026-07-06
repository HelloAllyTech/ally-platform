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
import {useHideReviewDetails} from '@/hooks/useHideReviewDetails';
import {RootStackScreenProps} from '@/navigation';
import {useRetrySummaryMutation} from '@/services/callSummaryApi';
import {useLazyGetScribeReactionsCountQuery} from '@/services/scribeReactionsApi';
import {useUpdateScribeReviewStatusMutation} from '@/services/scribeReviewsApi';
import {useLazyGetScribeThreadsQuery} from '@/services/scribeReviewThreadsApi';
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
  VoiceNoteSection,
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
    isTranscriptAvailable,
    isManualNote,
  } = useSummaryState(chatId, callId);

  // Bumped after voice dictation writes custom-field values server-side, to
  // remount CallSummaryDetails so it re-seeds from the fresh values.
  const [voiceApplyVersion, setVoiceApplyVersion] = useState(0);

  const hasFeedbackAlready = Boolean(
    summaryData?.details?.callInfo?.isSummaryFeedbackAdded,
  );
  const isUnauthorized =
    summaryError && getErrorDetails(summaryError).status === 403;
  const showTranscriptTab =
    Boolean(chatId) &&
    !isUnauthorized &&
    permissions?.includes(USER_PERMISSIONS.VIEW_MESSAGES);

  const dispatch = useAppDispatch();

  const {
    handleSummaryNameChange,
    isMenuVisible,
    isArchived,
    actionType,
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
    archived: !!summaryData?.archivedAt,
  });

  const {showToast} = useToast();

  const [retrySummary, {isLoading: isRetrying}] = useRetrySummaryMutation();

  // Failed-summary retry: regenerate the summary from the saved transcript (the
  // backend re-transcribes from stored audio when no transcript exists), then
  // refresh so the regenerated summary — or the still-failed state — is shown.
  const handleRetrySummary = useCallback(async () => {
    if (!chatId) return;
    try {
      const res = await retrySummary(chatId).unwrap();
      if (!res?.success) {
        showToast(res?.message || t('summaryLoading.retryFailed'), 'error');
      } else {
        showToast(t('summaryLoading.retryStarted'), 'success');
      }
    } catch {
      showToast(t('summaryLoading.retryFailed'), 'error');
    }
    handleRefresh();
  }, [chatId, retrySummary, showToast, t, handleRefresh]);

  const scribeReviewId = summaryData?.reviewId ?? undefined;
  const isSharedForReview =
    !!scribeReviewId && summaryData?.reviewStatus !== ReviewStatus.HIDDEN;

  const hasSummaryFailed = summaryStatus === ChatSummaryStatus.FAILED;
  const hasEditFeedbackPermission = permissions?.includes(
    USER_PERMISSIONS.EDIT_SUMMARY_FEEDBACK,
  );

  const handleShareForReview = useCallback(() => {
    if (!summaryData?.details) return;
    const details = summaryData.details;
    navigation.navigate(SCREEN_NAMES.SHARE_CALL_LOG, {
      scribeSessionId: summaryData.id,
      reviewId: scribeReviewId,
      sessionData: {
        title:
          callInfo.summaryName ||
          t('review.feedCard.sharedSimulationForReview'),
        createdAt: details.startTime || summaryData.createdAt || '',
        duration: formatDurationFromSeconds(details.callDuration ?? 0),
      },
      note: summaryData?.reviewNote || '',
    });
  }, [summaryData, callInfo.summaryName, navigation, t, scribeReviewId]);

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

  const {hideReviewDetails} = useHideReviewDetails({
    reviewId: scribeReviewId,
    isPrivate: summaryData?.reviewStatus === ReviewStatus.HIDDEN,
    useLazyThreadsQuery: useLazyGetScribeThreadsQuery,
    useLazyReactionsQuery: useLazyGetScribeReactionsCountQuery,
  });

  useHardwareBackPressHandler(() => {
    onBackNavigation();
    return true;
  });

  const onBackNavigation = () => {
    const summaryGenerated = isSummaryAvailable && canShowSummary;
    // Manual notes have no AI-generated summary to rate — never prompt.
    if (!summaryGenerated || isManualNote) {
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
    if (!hasFeedbackAlready && hasEditFeedbackPermission && !isManualNote) {
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

  const onSubmitSummaryFeedback = async (feedback: {
    rating: number;
    issues: string[];
    comment: string;
    tags: string[];
  }) => {
    const response = await onAddSummaryFeedback(feedback);
    if (response.data) {
      showToast(t('callFeedback.submitted'), 'success');
    } else {
      showToast(t('summaryLoading.summaryFeedbackSubmittedFailed'), 'error');
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
    (isSummaryAvailable && !canShowSummary) ||
    isLoading ||
    refreshing ||
    isRetrying;

  const summaryActionButtonText = useMemo(
    () =>
      isSummaryAvailable && !canShowSummary
        ? t('summaryLoading.settingUp')
        : hasSummaryFailed
          ? t('common.retry')
          : t('summaryLoading.seeIfReady'),
    [isSummaryAvailable, canShowSummary, hasSummaryFailed, t],
  );

  const renderSummaryButtons = () => {
    return (
      <View style={styles.summaryButtonsContainer}>
        {summaryStatus !== ChatSummaryStatus.NO_AUDIO && (
          <TouchableOpacity
            onPress={hasSummaryFailed ? handleRetrySummary : handleRefresh}
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
            label={t('summaryLoading.checkLater')}
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

    if ((isSummaryAvailable || isManualNote) && canShowSummary) {
      const shouldShowSaveButton =
        (!callId || hasChanges) && !isFeedbackPopupVisible;
      return (
        <View style={styles.summaryTabContainer}>
          {isManualNote && (
            <VoiceNoteSection
              chatId={chatId}
              onCustomValuesApplied={() => setVoiceApplyVersion(v => v + 1)}
            />
          )}
          <CallSummaryDetails
            key={voiceApplyVersion}
            isLoading={isLoading}
            onSubmit={onSaveButtonPress}
            showSaveButton={shouldShowSaveButton}
            chatId={chatId}
          />
        </View>
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
      {key: SUMMARY_TAB_KEY, title: t('postCallSummary.header.summary')},
    ];
    if (showTranscriptTab) {
      result.push({
        key: TRANSCRIPT_TAB_KEY,
        title: t('summary.tabs.transcript'),
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
      isManualNote,
      voiceApplyVersion,
    ],
  );

  const renderTabBar = useCallback(
    (props: Parameters<typeof TabBar>[0]) => (
      <TabBar
        {...props}
        scrollEnabled={false}
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
        mode={callInfo.mode}
        showShareSwitch={
          isSummaryAvailable &&
          summaryStatus === ChatSummaryStatus.SUCCESS &&
          isTranscriptAvailable &&
          !isArchived
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
      {!!scribeReviewId &&
        !hideReviewDetails &&
        hasScribeReviewPermission &&
        !isArchived && (
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

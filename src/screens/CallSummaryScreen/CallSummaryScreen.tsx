import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {SafeAreaView} from 'react-native-safe-area-context';

import {PrimaryButton, useToast} from '@/components';
import {ChatSummaryStatus, USER_PERMISSIONS} from '@/constants';
import {
  useAppNavigation,
  useCallSummaryActions,
  useCallSummaryForm,
  useHardwareBackPressHandler,
  useSummaryState,
  useTranslate,
} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {useGetSummaryFieldsQuery} from '@/services/settingsApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {selectCallInfo} from '@/store/slices/summarySlice';
import {colors} from '@/theme';
import {getErrorDetails, navigateToCallLogTab} from '@/utils';

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

  // Fetch summary fields on mount (follows web approach)
  const {refetch: refetchSummaryFields} = useGetSummaryFieldsQuery();

  useEffect(() => {
    // Refetch when callId changes to ensure fresh data
    refetchSummaryFields();
  }, [callId, refetchSummaryFields]);

  const {
    isLoading,
    refreshing,
    summaryData,
    summaryError,
    showSummary,
    setShowSummary,
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
  const showTranscriptOption =
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
    onHeaderPress,
    isSummaryDropdownVisible,
    hideHeaderDropdown,
    onAddSummaryFeedback,
  } = useCallSummaryActions({
    chatId: chatId || 0,
    name: callInfo.summaryName || '',
    isCallLogSummaryFlow: Boolean(callId),
  });

  const {showToast} = useToast();

  const hasSummaryFailed = summaryStatus === ChatSummaryStatus.FAILED;
  const hasEditFeedbackPermission = permissions?.includes(
    USER_PERMISSIONS.EDIT_SUMMARY_FEEDBACK,
  );

  const [mountTime] = useState<number>(Date.now());
  const [isFeedbackPopupVisible, setIsFeedbackPopupVisible] =
    useState<boolean>(false);
  const [showArchiveConfirmation, setShowArchiveConfirmation] =
    useState<boolean>(false);
  const [actionType, setActionType] = useState<'archive' | 'unarchive' | null>(
    null,
  );

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
    // If the summary is not yet generated/ready, allow immediate back navigation
    const summaryGenerated = isSummaryAvailable && canShowSummary;
    if (!summaryGenerated) {
      handleGoBack();
      return;
    }
    const currentTime = Date.now();
    const timeElapsed = currentTime - mountTime;
    const thresholdMs = 30 * 1000; // 30 seconds

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
          <PrimaryButton
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

  const renderContent = () => {
    if (isUnauthorized) {
      return <SummaryUnauthorized onGoBack={handleGoBack} />;
    }

    if (showSummary && isSummaryAvailable && canShowSummary) {
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

    if (showSummary) {
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
    }
    return null;
  };

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
        isSummaryDropdownVisible={isSummaryDropdownVisible}
        hideHeaderDropdown={hideHeaderDropdown}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
        showExportOption={isSummaryAvailable}
        isSummaryFeedbackPopup={isFeedbackPopupVisible}
        hideSummaryFeedbackPopup={() => setIsFeedbackPopupVisible(false)}
        onSubmitSummaryFeedback={onSubmitSummaryFeedback}
      />

      <Header
        onBackPress={onBackNavigation}
        onMenuPress={showMenu}
        summaryName={summaryName}
        showSummary={showSummary}
        onHeaderPress={onHeaderPress}
        showTranscript={showTranscriptOption}
      />

      {renderContent()}

      {!showSummary && <CallTranscript chatId={chatId || 0} />}
    </SafeAreaView>
  );
};

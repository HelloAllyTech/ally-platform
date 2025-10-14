import React, {useMemo, useState} from 'react';
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
import {ChatSummaryStatus} from '@/constants';
import {
  useAppNavigation,
  useCallSummaryActions,
  useCallSummaryForm,
  useHardwareBackPressHandler,
  useSummaryState,
  useTranslate,
} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {selectCallInfo} from '@/store/slices/summarySlice';
import {colors} from '@/theme';
import {navigateToCallLogTab} from '@/utils';

import {
  AddNotesSection,
  CallSummaryDetails,
  CallTranscript,
  Header,
  SummaryGenerationProgress,
  SummaryModals,
} from './components';
import {styles} from './styles';

export const CallSummaryScreen: React.FC<
  RootStackScreenProps<'CallSummary'>
> = ({route}) => {
  const {t} = useTranslate();
  const currentChat = useAppSelector(state => state.chat.currentChat);
  const callInfo = useAppSelector(selectCallInfo);
  const {hasChanges} = useCallSummaryForm();

  const callId = route.params?.callId;
  const fromLogs = route.params?.fromLogs;
  const chatId = callId || currentChat?.chatId;
  const showTranscript = Boolean(callId);

  const navigation = useAppNavigation();

  const {
    isLoading,
    refreshing,
    summaryData,
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

  const dispatch = useAppDispatch();

  const {
    handleSummaryNameChange,
    isMenuVisible,
    hideMenu,
    showMenu,
    handleExport,
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

  const [mountTime] = useState<number>(Date.now());
  const [isFeedbackPopupVisible, setIsFeedbackPopupVisible] =
    useState<boolean>(false);

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

    if ((timeElapsed >= thresholdMs || !fromLogs) && !hasFeedbackAlready) {
      setIsFeedbackPopupVisible(true);
      return;
    }

    handleGoBack();
  };

  const onSaveButtonPress = () => {
    if (!hasFeedbackAlready) setIsFeedbackPopupVisible(true);
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
    if (showSummary && isSummaryAvailable && canShowSummary) {
      const shouldShowSaveButton = !callId || hasChanges;
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
          {renderSummaryButtons()}
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
        isSummaryDropdownVisible={isSummaryDropdownVisible}
        hideHeaderDropdown={hideHeaderDropdown}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
        isSummaryAvailable={isSummaryAvailable}
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
        showTranscript={showTranscript}
      />

      {renderContent()}

      {!showSummary && <CallTranscript chatId={chatId || 0} />}
    </SafeAreaView>
  );
};

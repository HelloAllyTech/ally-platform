import React from 'react';
import {RefreshControl, StatusBar, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {SafeAreaView} from 'react-native-safe-area-context';

import {PrimaryButton} from '@/components';
import {SCREEN_NAMES} from '@/constants';
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
  const chatId = callId || currentChat?.chatId;
  const showTranscript = Boolean(callId);

  const navigation = useAppNavigation();

  const {
    isLoading,
    summaryData,
    showSummary,
    setShowSummary,
    canShowSummary,
    activeModal,
    setActiveModal,
    isSummaryAvailable,
    refreshing,
    isPollingComplete,
    handleRefresh,
    handleNoteChange,
    summaryStatus,
  } = useSummaryState(chatId, callId);

  const dispatch = useAppDispatch();

  const {
    handleSummaryNameChange,
    onUpdateSummary,
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
  } = useCallSummaryActions({
    chatId: chatId || 0,
    name: callInfo.summaryName || '',
    isCallLogSummaryFlow: Boolean(callId),
  });

  useHardwareBackPressHandler(() => {
    handleGoBack();
    return true;
  });

  const handleBlur = () => {
    if (handleSummaryNameChange) {
      handleSummaryNameChange(summaryName || '');
    }
  };

  const onViewCallLogs = () => {
    dispatch(clearCurrentChat());
    navigation.reset({
      index: 0,
      routes: [{name: SCREEN_NAMES.CALL_LOG}],
    });
  };

  const renderSummaryButtons = () => {
    return (
      <View style={styles.summaryButtonsContainer}>
        <PrimaryButton
          label={t('CallLogs.willCheckLater')}
          onPress={onViewCallLogs}
          customContainerStyle={styles.viewCallLogsButton}
          customTextStyle={styles.viewCallLogsButtonText}
        />
      </View>
    );
  };

  const renderContent = () => {
    if (showSummary && isSummaryAvailable && canShowSummary) {
      const shouldShowSaveButton = !callId || hasChanges;
      return (
        <CallSummaryDetails
          isLoading={isLoading}
          onSubmit={onUpdateSummary}
          showSaveButton={shouldShowSaveButton}
        />
      );
    }

    if (showSummary) {
      return (
        <>
          <KeyboardAwareScrollView
            style={styles.scrollView}
            nestedScrollEnabled
            extraScrollHeight={100}
            contentOffset={{x: 0, y: 100}}
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            enableOnAndroid
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
              />
            }>
            <SummaryGenerationProgress
              isSummaryGenerated={isSummaryAvailable}
              isPollingComplete={isPollingComplete}
              summaryStatus={summaryStatus}
            />
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
      />

      <Header
        onBackPress={handleGoBack}
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

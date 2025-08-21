import React, {useRef} from 'react';
import {
  RefreshControl,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  View,
} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';

import {LeftArrowIcon} from '@/assets';
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
import {colors} from '@/theme';

import {
  AddNotesSection,
  CallSummaryDetails,
  CallTranscript,
  Header,
  SummaryGenerationProgress,
  SummaryModals,
  SummaryView,
} from './components';
import {styles} from './styles';

export const CallSummaryScreen: React.FC<
  RootStackScreenProps<'CallSummary'>
> = ({route}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
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
    isFullyExpanded,
    showSummary,
    setShowSummary,
    showInfoModal,
    setShowInfoModal,
    canShowSummary,
    setCanShowSummary,
    activeModal,
    setActiveModal,
    showScrollToBottom,
    showAnimation,
    isSummaryAvailable,
    forceRemountKey,
    refreshing,
    isPollingComplete,
    handleScroll,
    handleRefresh,
    handleNoteChange,
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

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({animated: true});
  };

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

  const onPressViewSummary = () => {
    handleRefresh();
    setCanShowSummary(true);
  };

  const renderSummaryButtons = () => {
    return (
      <View style={styles.summaryButtonsContainer}>
        {isSummaryAvailable && (
          <PrimaryButton
            label={t('CallSummary.viewSummary')}
            onPress={onPressViewSummary}
            customContainerStyle={styles.viewSummaryButton}
            customTextStyle={styles.viewSummaryButtonText}
          />
        )}
        <PrimaryButton
          label={t('CallLogs.viewCallLogs')}
          onPress={onViewCallLogs}
          customContainerStyle={styles.viewCallLogsButton}
          customTextStyle={styles.viewCallLogsButtonText}
        />
      </View>
    );
  };

  const renderContent = () => {
    if (showSummary && isSummaryAvailable && canShowSummary) {
      return (
        <SummaryView
          showAnimation={showAnimation}
          forceRemountKey={forceRemountKey}
          insets={insets}
          onScroll={handleScroll}
          scrollViewRef={scrollViewRef}>
          <CallSummaryDetails
            isLoading={isLoading}
            onSubmit={onUpdateSummary}
            showSubmitButton={callId ? hasChanges : true}
          />
        </SummaryView>
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
            />
            <AddNotesSection
              savedNotes={summaryData?.details?.callInfo?.notes || ''}
              onNoteChange={handleNoteChange}
              onPressInfo={() => {
                setShowInfoModal(true);
              }}
            />
          </KeyboardAwareScrollView>
          {renderSummaryButtons()}
        </>
      );
    }
    return null;
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        {backgroundColor: !showAnimation ? colors.white : colors.black},
      ]}>
      <StatusBar barStyle={!showAnimation ? 'dark-content' : 'light-content'} />

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
        isFullyExpanded={isFullyExpanded}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
        showInfoModal={showInfoModal}
        setShowInfoModal={setShowInfoModal}
        isSummaryAvailable={isSummaryAvailable}
      />

      <Header
        isFullyExpanded={isFullyExpanded}
        onBackPress={handleGoBack}
        onMenuPress={showMenu}
        summaryName={summaryName}
        showAnimation={showAnimation}
        showSummary={showSummary}
        onHeaderPress={onHeaderPress}
        showTranscript={showTranscript}
      />

      {renderContent()}

      {!showSummary && <CallTranscript chatId={chatId || 0} />}

      {isSummaryAvailable && showScrollToBottom && showSummary && (
        <TouchableOpacity
          style={styles.scrollToBottomButton}
          onPress={scrollToBottom}>
          <LeftArrowIcon width={40} height={40} style={styles.downArrow} />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

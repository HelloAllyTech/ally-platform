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

import {LeftArrowIcon} from '@/assets/icons';
import {PrimaryButton} from '@/components/Button/PrimaryButton';
import {Toast} from '@/components/Toast/Toast';
import {useAppNavigation} from '@/hooks/useAppNavigation';
import useCallSummaryActions from '@/hooks/useCallSummaryActions';
import {useCallSummaryForm} from '@/hooks/useCallSummaryForm';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import {useSummaryState} from '@/hooks/useSummaryState';
import {RootStackScreenProps} from '@/navigation/types';
import {useAppSelector} from '@/store/hooks';
import {selectCallInfo} from '@/store/slices/summarySlice';
import {colors} from '@/theme/colors';

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
    handleScroll,
    handleRefresh,
    handleNoteChange,
  } = useSummaryState(chatId, callId);

  const {
    handleSummaryNameChange,
    onUpdateSummary,
    isMenuVisible,
    hideMenu,
    showMenu,
    handleExport,
    handleDelete,
    handleGoBack,
    hideToast,
    toast,
    summaryName,
    setSummaryName,
    onHeaderPress,
    isSummaryDropdownVisible,
    hideHeaderDropdown,
  } = useCallSummaryActions({
    chatId: chatId || 0,
    currentChat: currentChat!,
    name: callInfo.summaryName || '',
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
    navigation.reset({
      index: 1,
      routes: [{name: 'Home'}, {name: 'CallLog'}],
    });
  };

  const renderSummaryButtons = () => {
    return (
      <View style={styles.summaryButtonsContainer}>
        {isSummaryAvailable && (
          <PrimaryButton
            label="View Summary"
            onPress={() => {
              setCanShowSummary(true);
            }}
            customContainerStyle={styles.viewSummaryButton}
            customTextStyle={styles.viewSummaryButtonText}
          />
        )}
        <PrimaryButton
          label="View Call logs"
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
        <CallSummaryDetails
          isLoading={isLoading}
          onSubmit={onUpdateSummary}
          showSubmitButton={callId ? hasChanges : true}
        />
      );
    }

    if (showSummary) {
      return (
        <>
          <KeyboardAwareScrollView
            style={styles.scrollView}
            nestedScrollEnabled
            extraScrollHeight={200}
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
            />
            <View>
              <AddNotesSection
                onNoteChange={handleNoteChange}
                onPressInfo={() => {
                  setShowInfoModal(true);
                }}
              />
            </View>
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

      <SummaryView
        showAnimation={showAnimation}
        forceRemountKey={forceRemountKey}
        insets={insets}
        onScroll={handleScroll}
        isSummaryAvailable={isSummaryAvailable}
        isFullyExpanded={isFullyExpanded}
        scrollViewRef={scrollViewRef}>
        {renderContent()}
      </SummaryView>

      {!showSummary && <CallTranscript chatId={chatId || 0} />}

      {isSummaryAvailable && showScrollToBottom && showSummary && (
        <TouchableOpacity
          style={styles.scrollToBottomButton}
          onPress={scrollToBottom}>
          <LeftArrowIcon width={40} height={40} style={styles.downArrow} />
        </TouchableOpacity>
      )}

      {toast.visible && (
        <Toast message={toast.message} type={toast.type} onHide={hideToast} />
      )}
    </SafeAreaView>
  );
};

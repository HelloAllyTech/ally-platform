import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {moderateScale} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets/icons';
import {Toast} from '@/components/Toast/Toast';
import {WINDOW_HEIGHT} from '@/constants/general';
import useCallSummaryActions from '@/hooks/useCallSummaryActions';
import {useCallSummaryForm} from '@/hooks/useCallSummaryForm';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import {RootStackScreenProps} from '@/navigation/types';
import {useLazyGetCallSummaryQuery} from '@/services/callSummaryApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearSummaryStates, selectCallInfo} from '@/store/slices/summarySlice';
import {colors} from '@/theme/colors';

import {CallSummaryDetails} from './components/CallSummaryDetails/CallSummaryDetails';
import CallTranscript from './components/CallTranscript/CallTranscript';
import CustomMenuModal from './components/CustomMenuModal/CustomMenuModal';
import {DeleteRenameModal} from './components/DeleteRenameModal/DeleteRenameModal';
import {Header} from './components/Header/Header';
import SummaryDropdown from './components/Header/SummaryDropdown';
import {SummaryGenerationProgress} from './components/SummaryGenerationProgress/SummaryGenerationProgress';
import {styles} from './styles';

/**
 * CallSummaryScreen component displays a summary of the call with an animated card interface.
 * The card can be expanded/collapsed with smooth animations and maintains a scrollable content area.
 */

type ModalType = 'rename' | 'delete' | null;

const windowHeight = WINDOW_HEIGHT;
const maxBorderRadius = 30;

export const CallSummaryScreen: React.FC<
  RootStackScreenProps<'CallSummary'>
> = ({route}) => {
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const cardHeight = useSharedValue(0);
  const currentChat = useAppSelector(state => state.chat.currentChat);
  const callInfo = useAppSelector(selectCallInfo);
  const dispatch = useAppDispatch();
  const [fetchCallSummary, {isLoading, data: summaryData}] =
    useLazyGetCallSummaryQuery();
  const {hasChanges} = useCallSummaryForm();

  const callId = route.params?.callId;
  const chatId = callId || currentChat?.chatId;
  const scrollViewRef = useRef<ScrollView>(null);
  const showTranscript = Boolean(callId);

  const [isFullyExpanded, setIsFullyExpanded] = useState(true);
  const [showSummary, setShowSummary] = useState(true);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [editedName, setEditedName] = useState(callInfo.summaryName);
  const [showAnimation, setShowAnimation] = useState(!callId);
  const [isSummaryAvailable, setIsSummaryAvailable] = useState(false);
  const [hasCollapsedBeenShown, setHasCollapsedBeenShown] = useState(false);
  /**
   * React Native bug workaround:
   * When showAnimation transitions from true to false (after the card expands),
   * the touch responder system may not recalculate the touchable area for the card and its children.
   * Forcing a remount of the card ensures the layout and touch regions are recalculated,
   * preventing touch issues on section headers after scrolling.
   */
  const [forceRemountKey, setForceRemountKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Restore useCallSummaryActions destructure
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
    onHeaderPress,
    isSummaryDropdownVisible,
    hideHeaderDropdown,
  } = useCallSummaryActions({
    chatId: chatId || 0,
    currentChat: currentChat!,
    name: callInfo.summaryName || '',
  });

  useEffect(() => {
    setEditedName(summaryName);
  }, [summaryName]);

  // Initial polling logic
  useEffect(() => {
    let pollTimeout: NodeJS.Timeout | null = null;

    const poll = async () => {
      if (!chatId) return;
      await fetchCallSummary(chatId);
      // Do not check summaryData here; let the summaryData watcher handle it
    };

    // On mount, fetch summary
    poll();

    // Poll again after 5 seconds
    pollTimeout = setTimeout(() => {
      poll();
    }, 5000);

    return () => {
      if (pollTimeout) clearTimeout(pollTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Watch for summaryData changes
  useEffect(() => {
    if (summaryData?.details?.summary) {
      setIsSummaryAvailable(true);
    }
  }, [summaryData]);
  console.log(
    '🚀 ~ useEffect ~ summaryData?.details?.summary:',
    summaryData?.details?.summary,
  );

  // Cleanup summary state on unmount
  useEffect(() => {
    return () => {
      dispatch(clearSummaryStates());
    };
  }, [dispatch]);

  useEffect(() => {
    if (hasCollapsedBeenShown && showAnimation) {
      setShowAnimation(false);
      setForceRemountKey(prev => prev + 1);
    }
  }, [hasCollapsedBeenShown, showAnimation]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const {contentOffset, layoutMeasurement, contentSize} = event.nativeEvent;

      scrollY.value = contentOffset.y;
      setIsFullyExpanded(contentOffset.y <= 80);

      // Only track hasCollapsedBeenShown if animation is still on
      if (showAnimation && contentOffset.y > 80 && !hasCollapsedBeenShown) {
        setHasCollapsedBeenShown(true);
      }

      // Check if we're near the bottom
      const paddingToBottom = moderateScale(30);
      const isCloseToBottom =
        layoutMeasurement.height + contentOffset.y >=
        contentSize.height - paddingToBottom;
      setShowScrollToBottom(!isCloseToBottom);
    },
    [showAnimation, hasCollapsedBeenShown, scrollY],
  );

  const handleLayout = useCallback(() => {
    cardHeight.value = WINDOW_HEIGHT * 0.8;
  }, [cardHeight]);

  useHardwareBackPressHandler(() => {
    handleGoBack();
    return true;
  });

  const animatedCardStyle = useAnimatedStyle(() => {
    const newHeight = Math.min(cardHeight.value + scrollY.value, windowHeight);
    const progress =
      (newHeight - cardHeight.value) / (windowHeight - cardHeight.value);
    const borderRadius = withSpring(maxBorderRadius * (1 - progress), {
      damping: 15,
      stiffness: 120,
      mass: 0.5,
    });

    return {
      height: withSpring(newHeight, {
        damping: 15,
        stiffness: 120,
        mass: 0.5,
        velocity: 0.5,
      }),
      borderTopLeftRadius: borderRadius,
      borderTopRightRadius: borderRadius,
    };
  });

  // Pull to refresh handler
  const handleRefresh = useCallback(async () => {
    if (!chatId) return;
    setRefreshing(true);
    await fetchCallSummary(chatId);
    setRefreshing(false);
  }, [chatId, fetchCallSummary]);

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({animated: true});
  };

  const handleBlur = () => {
    if (handleSummaryNameChange) {
      handleSummaryNameChange(editedName || '');
    }
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        {backgroundColor: !showAnimation ? colors.white : colors.black},
      ]}>
      <StatusBar barStyle={!showAnimation ? 'dark-content' : 'light-content'} />
      <DeleteRenameModal
        activeModal={activeModal || ''}
        setActiveModal={modal => setActiveModal(modal as ModalType)}
        handleDelete={handleDelete}
        handleBlur={handleBlur}
        editedName={editedName || ''}
        setEditedName={setEditedName}
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
      <SummaryDropdown
        visible={isSummaryDropdownVisible}
        onClose={hideHeaderDropdown}
        isFullyExpanded={isFullyExpanded}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
      />
      <CustomMenuModal
        visible={isMenuVisible}
        onClose={hideMenu}
        onExport={handleExport}
        setModalType={setActiveModal}
      />
      <Animated.View
        key={forceRemountKey}
        style={[
          styles.card,
          showAnimation && animatedCardStyle,
          {maxHeight: WINDOW_HEIGHT - insets.top},
        ]}>
        {showSummary ? (
          <ScrollView
            ref={scrollViewRef}
            scrollEnabled={isSummaryAvailable}
            onScroll={handleScroll}
            scrollEventThrottle={8}
            onLayout={handleLayout}
            contentContainerStyle={[
              !isSummaryAvailable && styles.height100,
              (!isFullyExpanded || !showAnimation) && isSummaryAvailable
                ? styles.contentContainer
                : {},
            ]}>
            {isSummaryAvailable ? (
              <CallSummaryDetails
                isLoading={isLoading}
                onSubmit={onUpdateSummary}
                // show submit button always after coming from live call else only if there are changes
                showSubmitButton={callId ? hasChanges : true}
              />
            ) : (
              <SummaryGenerationProgress
                refreshing={refreshing}
                onRefresh={handleRefresh}
              />
            )}
          </ScrollView>
        ) : (
          <CallTranscript chatId={chatId || 0} />
        )}
      </Animated.View>
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

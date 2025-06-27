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
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import {RootStackScreenProps} from '@/navigation/types';
import {useLazyGetCallSummaryQuery} from '@/services/callSummaryApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearSummaryStates, selectCallInfo} from '@/store/slices/summarySlice';
import {colors} from '@/theme/colors';

import {CallSummaryDetails} from './components/CallSummaryDetails/CallSummaryDetails';
import {CallSummaryProgress} from './components/CallSummaryProgress/CallSummaryProgress';
import CallTranscript from './components/CallTranscript/CallTranscript';
import CustomMenuModal from './components/CustomMenuModal/CustomMenuModal';
import {DeleteRenameModal} from './components/DeleteRenameModal/DeleteRenameModal';
import {Header} from './components/Header/Header';
import SummaryDropdown from './components/Header/SummaryDropdown';
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
  const [fetchCallSummary, {isLoading}] = useLazyGetCallSummaryQuery();

  const callId = route.params?.callId;
  const chatId = callId || currentChat?.chatId;
  const scrollViewRef = useRef<ScrollView>(null);
  const showTranscript = Boolean(callId);

  const [summaryProgressComplete, setSummaryProgressComplete] = useState(false);
  const [isFullyExpanded, setIsFullyExpanded] = useState(true);
  const [showSummary, setShowSummary] = useState(true);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [editedName, setEditedName] = useState(callInfo.summaryName);
  const [showAnimation, setShowAnimation] = useState(!callId);
  const [hasCollapsedBeenShown, setHasCollapsedBeenShown] = useState(false);

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

  useEffect(() => {
    if (chatId) {
      fetchCallSummary(chatId);
    }
  }, [chatId, fetchCallSummary]);

  // Cleanup function to clear summary state when component unmounts
  useEffect(() => {
    return () => {
      dispatch(clearSummaryStates());
    };
  }, [dispatch]);

  useEffect(() => {
    if (hasCollapsedBeenShown && showAnimation) {
      setShowAnimation(false);
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

  const isShowCallSummary = Boolean(
    callId || (summaryProgressComplete && currentChat?.chatId),
  );

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
        style={[
          styles.card,
          showAnimation && animatedCardStyle,
          {maxHeight: WINDOW_HEIGHT - insets.top},
        ]}>
        {showSummary ? (
          <ScrollView
            ref={scrollViewRef}
            scrollEnabled={isShowCallSummary}
            onScroll={handleScroll}
            scrollEventThrottle={8}
            onLayout={handleLayout}
            contentContainerStyle={
              !isFullyExpanded || !showAnimation ? styles.contentContainer : {}
            }>
            {isShowCallSummary ? (
              <CallSummaryDetails
                isLoading={isLoading}
                onSubmit={onUpdateSummary}
              />
            ) : (
              <CallSummaryProgress
                onProgressComplete={() => {
                  setSummaryProgressComplete(true);
                }}
                animationDuration={300}
              />
            )}
          </ScrollView>
        ) : (
          <CallTranscript chatId={chatId || 0} />
        )}
      </Animated.View>
      {isShowCallSummary && showScrollToBottom && showSummary && (
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

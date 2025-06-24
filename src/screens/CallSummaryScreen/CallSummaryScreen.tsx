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
import {moderateScale, ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets/icons';
import {Toast} from '@/components/Toast/Toast';
import {isIOS, WINDOW_HEIGHT} from '@/constants/general';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import {useStoragePermissions} from '@/hooks/useStoragePermissions';
import useTranslate from '@/hooks/useTranslate';
import {TranslationType} from '@/localization/locales/type';
import {RootStackScreenProps} from '@/navigation/types';
import {
  useLazyExportCallSummaryQuery,
  useLazyGetCallSummaryQuery,
  useUpdateCallInfoMutation,
  useUpdateCallSummaryMutation,
} from '@/services/callSummaryApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {clearSummaryStates, selectCallInfo} from '@/store/slices/summarySlice';
import {colors} from '@/theme/colors';
import {saveFile} from '@/utils/fileOperations';
import {logger} from '@/utils/logger';

import {CallSummaryDetails} from './components/CallSummaryDetails/CallSummaryDetails';
import {CallSummaryProgress} from './components/CallSummaryProgress/CallSummaryProgress';
import CallTranscript from './components/CallTranscript/CallTranscript';
import CustomMenuModal from './components/CustomMenuModal/CustomMenuModal';
import {DeleteRenameModal} from './components/DeleteRenameModal/DeleteRenameModal';
import {Header} from './components/Header/Header';
import SummaryDropdown from './components/Header/SummaryDropdown';

/**
 * CallSummaryScreen component displays a summary of the call with an animated card interface.
 * The card can be expanded/collapsed with smooth animations and maintains a scrollable content area.
 */

interface ToastState {
  visible: boolean;
  message: string;
  type: 'success' | 'error' | 'info';
}

type ModalType = 'rename' | 'delete' | null;

export const CallSummaryScreen: React.FC<
  RootStackScreenProps<'CallSummary'>
> = ({navigation, route}) => {
  const windowHeight = WINDOW_HEIGHT;
  const maxBorderRadius = 30;
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const cardHeight = useSharedValue(0);
  const [summaryProgressComplete, setSummaryProgressComplete] = useState(false);
  const [isFullyExpanded, setIsFullyExpanded] = useState(true);
  const currentChat = useAppSelector(state => state.chat.currentChat);
  const callInfo = useAppSelector(selectCallInfo);
  const callId = route.params?.callId;
  const chatId = callId || currentChat?.chatId;
  const dispatch = useAppDispatch();
  const [fetchCallSummary, {isLoading}] = useLazyGetCallSummaryQuery();
  const [exportCallSummary] = useLazyExportCallSummaryQuery();
  const [updateCallSummary] = useUpdateCallSummaryMutation();
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isSummaryDropdownVisible, setIsSummaryDropdownVisible] =
    useState(false);
  const [showSummary, setShowSummary] = useState(true);
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    type: 'error',
  });
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const {t} = useTranslate();
  const scrollViewRef = useRef<ScrollView>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [summaryName, setSummaryName] = useState(callInfo.summaryName);

  const [editedName, setEditedName] = useState(summaryName);
  const [updateCallInfo] = useUpdateCallInfoMutation();
  const [showAnimation, setShowAnimation] = useState(!callId);
  const [hasCollapsedBeenShown, setHasCollapsedBeenShown] = useState(false);
  const showTranscript = Boolean(callId);

  useEffect(() => {
    setEditedName(summaryName);
  }, [summaryName]);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'error') => {
      setToast({
        visible: true,
        message,
        type,
      });
    },
    [],
  );

  const {checkAndRequestPermissions} = useStoragePermissions(showToast);

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
    if (callInfo.summaryName) {
      setSummaryName(callInfo.summaryName);
    }
  }, [callInfo.summaryName]);

  const hideToast = useCallback(() => {
    setToast(prev => ({...prev, visible: false}));
  }, []);

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

  const handleGoBack = useCallback(() => {
    if (currentChat) {
      navigation.reset({
        index: 0,
        routes: [{name: 'Home'}],
      });
      dispatch(clearCurrentChat());
    } else {
      navigation.goBack();
    }
  }, [currentChat, navigation, dispatch]);

  const onUpdateSummary = useCallback(
    (isSuccess: boolean) => {
      if (isSuccess) {
        showToast(t('CallSummary.info.summaryUpdatedSuccess'), 'success');
        setTimeout(() => {
          handleGoBack();
        }, 2000);
      } else {
        showToast(t('CallSummary.info.summaryUpdateFailed'));
      }
    },
    [showToast, t, handleGoBack],
  );

  const handleExport = async () => {
    if (!chatId) return;

    try {
      const hasPermission = await checkAndRequestPermissions();
      if (!hasPermission) return;

      const response = await exportCallSummary(chatId).unwrap();
      if (typeof response !== 'string') {
        throw new Error(t('CallSummary.info.invalidResponseFormat'));
      }

      const filePath = await saveFile({
        content: response,
        chatId,
        t,
      });
      logger.info(t('CallSummary.info.fileSavedSuccess', {path: filePath}));

      showToast(
        `${t('CallSummary.info.fileExportedSuccess')} \n ${
          isIOS && 'on My iPhone/ally/CallSummary'
        }`,
        'success',
      );
      setIsMenuVisible(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : t('CallSummary.info.fileExportFailed');
      logger.error(errorMessage);
      showToast(errorMessage);
    }
  };

  const handleDelete = async () => {
    if (chatId) {
      try {
        const response = await updateCallSummary({
          chatId,
          data: {summary: {}},
        });
        showToast(t('CallSummary.info.summaryDeletedSuccess'), 'success');
        setIsMenuVisible(false);
        if (response.data) {
          setTimeout(() => {
            navigation.goBack();
          }, 2000);
        } else {
          showToast(t('CallSummary.info.summaryDeleteFailed'));
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : t('CallSummary.info.summaryDeleteFailed');
        logger.error(errorMessage);
        showToast(errorMessage);
      }
    }
  };

  const handleSummaryNameChange = async (name: string) => {
    if (chatId) {
      try {
        await updateCallInfo({
          chatId,
          summaryName: name,
        }).unwrap();
        setSummaryName(name);
        showToast(
          t('CallSummary.info.summaryNameUpdateSuccess' as TranslationType),
          'success',
        );
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : t('CallSummary.info.summaryNameUpdateFailed' as TranslationType);
        logger.error(errorMessage);
        showToast(errorMessage);
      }
    }
  };

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

  useEffect(() => {
    if (hasCollapsedBeenShown && showAnimation) {
      setShowAnimation(false);
    }
  }, [hasCollapsedBeenShown, showAnimation]);

  const onHeaderPress = () => {
    setIsSummaryDropdownVisible(true);
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
        onMenuPress={() => setIsMenuVisible(true)}
        summaryName={summaryName}
        showAnimation={showAnimation}
        showSummary={showSummary}
        onHeaderPress={onHeaderPress}
        showTranscript={showTranscript}
      />
      <SummaryDropdown
        visible={isSummaryDropdownVisible}
        onClose={() => setIsSummaryDropdownVisible(false)}
        isFullyExpanded={isFullyExpanded}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
      />
      <CustomMenuModal
        visible={isMenuVisible}
        onClose={() => setIsMenuVisible(false)}
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

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
  },
  card: {
    backgroundColor: colors.white,
    marginTop: 0,
    overflow: 'hidden',
    minHeight: WINDOW_HEIGHT * 0.8,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: '60@vs',
    left: '50%',
    // To take into account the width of the arrow button
    marginLeft: '-20@s',
    width: '40@s',
    height: '40@s',
    borderRadius: '20@s',
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  contentContainer: {
    paddingTop: '80@ms',
  },
  paddingTop: {
    paddingTop: '80@ms',
  },
  downArrow: {
    transform: [{rotate: '270deg'}],
  },
});

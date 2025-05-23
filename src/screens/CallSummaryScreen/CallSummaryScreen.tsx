import React, {useEffect, useState} from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  PermissionsAndroid,
  Platform,
  ScrollView,
} from 'react-native';
import RNFS from 'react-native-fs';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {Toast} from '@/components/Toast/Toast';
import {isIOS, WINDOW_HEIGHT} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {RootStackScreenProps} from '@/navigation/types';
import {
  CallSummaryResponse,
  useDeleteCallSummaryMutation,
  useLazyExportCallSummaryQuery,
  useLazyGetCallSummaryQuery,
} from '@/services/callSummaryApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {colors} from '@/theme/colors';
import {logger} from '@/utils/logger';

import {CallSummaryDetails} from './components/CallSummaryDetails/CallSummaryDetails';
import {CallSummaryProgress} from './components/CallSummaryProgress/CallSummaryProgress';
import CustomMenuModal from './components/CustomMenuModal/CustomMenuModal';
import {Header} from './components/Header/Header';

/**
 * CallSummaryScreen component displays a summary of the call with an animated card interface.
 * The card can be expanded/collapsed with smooth animations and maintains a scrollable content area.
 */

interface ToastState {
  visible: boolean;
  message: string;
  type: 'success' | 'error' | 'info';
}

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
  const callId = route.params?.callId;
  const chatId = callId || currentChat?.chatId;
  const dispatch = useAppDispatch();
  const [fetchCallSummary, {data: summaryData, isLoading}] =
    useLazyGetCallSummaryQuery();
  const [exportCallSummary] = useLazyExportCallSummaryQuery();
  const [deleteCallSummary] = useDeleteCallSummaryMutation();
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    type: 'error',
  });
  const {t} = useTranslate();

  useEffect(() => {
    if (chatId) {
      fetchCallSummary(chatId);
    }
  }, [chatId, fetchCallSummary]);

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'info' = 'error',
  ) => {
    setToast({
      visible: true,
      message,
      type,
    });
  };

  const hideToast = () => {
    setToast(prev => ({...prev, visible: false}));
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.value = event.nativeEvent.contentOffset.y;
    setIsFullyExpanded(event.nativeEvent.contentOffset.y <= 80);
  };

  const handleLayout = () => {
    cardHeight.value = WINDOW_HEIGHT * 0.8;
  };

  const handleBackPress = () => {
    if (currentChat) {
      dispatch(clearCurrentChat());
      navigation.navigate('Home');
    } else {
      navigation.goBack();
    }
  };

  const handleExport = async () => {
    if (chatId) {
      try {
        if (!isIOS) {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          );
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            showToast(t('CallSummary.info.storagePermissionDenied'));
            return;
          }
        }

        const response = await exportCallSummary(chatId).unwrap();
        if (typeof response !== 'string') {
          throw new Error(t('CallSummary.info.invalidResponseFormat'));
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `call-summary-${timestamp}.txt`;
        const directory = Platform.select({
          ios: RNFS.DocumentDirectoryPath,
          android: RNFS.DownloadDirectoryPath,
        });

        if (!directory) {
          throw new Error(t('CallSummary.info.directoryPathError'));
        }

        const filePath = `${directory}/${filename}`;
        await RNFS.writeFile(filePath, response, 'utf8');

        if (!isIOS) {
          await RNFS.scanFile(filePath);
        }
        logger.info(t('CallSummary.info.fileSavedSuccess', {path: filePath}));

        showToast(t('CallSummary.info.fileExportedSuccess'), 'success');
        setIsMenuVisible(false);
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : t('CallSummary.info.fileExportFailed');
        logger.error(errorMessage);
        showToast(errorMessage);
      }
    }
  };

  const handleDelete = async () => {
    if (chatId) {
      try {
        await deleteCallSummary(chatId).unwrap();
        showToast(t('CallSummary.info.summaryDeletedSuccess'), 'success');
        setIsMenuVisible(false);
        navigation.goBack();
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

  return (
    <SafeAreaView style={styles.container}>
      <Header
        isFullyExpanded={isFullyExpanded}
        onBackPress={handleBackPress}
        onMenuPress={() => setIsMenuVisible(true)}
        callId={callId?.toString()}
        createdAt={summaryData?.details?.createdAt}
      />
      <CustomMenuModal
        visible={isMenuVisible}
        onClose={() => setIsMenuVisible(false)}
        onExport={handleExport}
        onDelete={handleDelete}
      />
      <Animated.View
        style={[
          styles.card,
          animatedCardStyle,
          {maxHeight: WINDOW_HEIGHT - insets.top - 90},
        ]}>
        <ScrollView
          scrollEnabled={isShowCallSummary}
          onScroll={handleScroll}
          scrollEventThrottle={8}
          onLayout={handleLayout}
          contentContainerStyle={styles.stepList}>
          {isShowCallSummary ? (
            <CallSummaryDetails
              summaryData={summaryData as CallSummaryResponse}
              isLoading={isLoading}
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
      </Animated.View>
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
  stepList: {
    paddingBottom: '20@ms',
  },
});

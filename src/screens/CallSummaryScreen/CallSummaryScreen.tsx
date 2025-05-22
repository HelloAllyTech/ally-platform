import React, {useEffect, useState} from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon, ThreeDotsIcon} from '@/assets/icons';
import {WINDOW_HEIGHT} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {RootStackScreenProps} from '@/navigation/types';
import {
  CallSummaryResponse,
  useLazyGetCallSummaryQuery,
} from '@/services/callSummaryApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {formatCallId} from '@/utils/callIdFormatter';

import {CallSummaryDetails} from './components/CallSummaryDetails/CallSummaryDetails';
import {CallSummaryProgress} from './components/CallSummaryProgress/CallSummaryProgress';

/**
 * CallSummaryScreen component displays a summary of the call with an animated card interface.
 * The card can be expanded/collapsed with smooth animations and maintains a scrollable content area.
 */
export const CallSummaryScreen: React.FC<
  RootStackScreenProps<'CallSummary'>
> = ({navigation, route}) => {
  const {t} = useTranslate();
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

  useEffect(() => {
    if (chatId) {
      fetchCallSummary(chatId);
    }
  }, [chatId, fetchCallSummary]);
  /**
   * Handles the scroll event and updates the scroll position value
   */
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.value = event.nativeEvent.contentOffset.y;
    // Check if card is fully expanded (when scroll position is at the top)
    setIsFullyExpanded(event.nativeEvent.contentOffset.y <= 80);
  };

  /**
   * Handles the layout event and sets the initial card height
   */
  const handleLayout = () => {
    cardHeight.value = WINDOW_HEIGHT * 0.8;
  };

  /**
   * Handles the back button press to navigate back
   */
  const handleBackPress = () => {
    if (currentChat) {
      dispatch(clearCurrentChat());
      navigation.navigate('Home');
    } else {
      navigation.goBack();
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

  const renderSummeryTitle = () => {
    if (!isFullyExpanded) {
      return (
        <View style={styles.expandedTitleContainer}>
          <View style={styles.expandedTitleContent}>
            <View style={styles.expandedSummeryTitleContainer}>
              <TouchableOpacity
                style={styles.backButtonExpanded}
                onPress={handleBackPress}>
                <LeftArrowIcon />
              </TouchableOpacity>
              <View>
                <Text style={styles.expandedSummeryTitle}>
                  {t('CallSummary.header.title')}{' '}
                  <Text style={styles.headerSubtitle}>
                    {t('CallSummary.header.subtitle')}
                  </Text>
                </Text>
                <Text style={styles.expandedSubTitle}>
                  {callId && summaryData?.createdAt
                    ? formatCallId(
                        callId.toString(),
                        summaryData?.details?.createdAt,
                      )
                    : ''}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.moreOptionsContainer}>
              <ThreeDotsIcon />
            </TouchableOpacity>
          </View>
        </View>
      );
    } else {
      return (
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
            <LeftArrowIcon />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {t('CallSummary.header.title')}{' '}
            <Text style={styles.headerSubtitle}>
              {t('CallSummary.header.subtitle')}
            </Text>
          </Text>
        </View>
      );
    }
  };

  const isShowCallSummary = Boolean(
    callId || (summaryProgressComplete && currentChat?.chatId),
  );

  return (
    <SafeAreaView style={styles.container}>
      {renderSummeryTitle()}
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
            // TO DO: Remove hardcoded chatId once future API is implemented
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
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: '20@ms',
    paddingTop: '40@ms',
  },
  backButton: {
    backgroundColor: colors.ashGray,
    borderRadius: '22@ms',
    width: '44@ms',
    height: '44@ms',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: '12@ms',
    opacity: 0.8,
  },
  headerTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '24@ms',
    color: colors.white,
    fontWeight: '400',
  },
  headerSubtitle: {
    fontStyle: 'italic',
    fontWeight: '500',
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
  expandedSummeryTitleContainer: {
    flexDirection: 'row',
    height: '80@ms',
    alignItems: 'center',
  },
  expandedSummeryTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
  },
  expandedSubTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    paddingTop: '4@ms',
    color: colors.black,
  },
  backButtonExpanded: {
    paddingLeft: '4@ms',
  },
  expandedTitleContainer: {
    backgroundColor: colors.white,
    height: '100@ms',
  },
  expandedTitleContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.ashGray,
  },
  moreOptionsContainer: {
    paddingRight: '20@ms',
  },
});

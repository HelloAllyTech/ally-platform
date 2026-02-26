/* eslint-disable react-hooks/exhaustive-deps */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  BottomSheetFlatList,
  BottomSheetFooter,
  BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import {
  ActivityIndicator,
  Animated,
  LayoutChangeEvent,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {ChevronRight} from '@/assets/icons';
import {
  BottomSheet,
  CommentBottomSheetFooter,
  ReviewComment,
} from '@/components';
import {useTranslate, useUser} from '@/hooks';
import {useLazyGetThreadsQuery} from '@/services/reviewThreadsApi';
import {colors} from '@/theme';
import {Thread, ThreadsResponse} from '@/types/reviews';
import {formatRelativeTime} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {GeneralCommentsList} from './GeneralCommentsList';
import {styles} from './styles';
import {ThreadsBottomSheetProps} from './types';

const LIMIT = 20;
const TAB_COUNT = 2;
const INDICATOR_ANIM_DURATION = 250;

type TabKey = 'inline' | 'general';

const GRADIENT_COLORS = [
  colors.whiteTransparent0,
  colors.whiteTransparent40,
  colors.whiteTransparent60,
];

const getSelectedText = (thread: Thread): string | null => {
  if (
    !thread.message?.content ||
    thread.selection?.startIndex === undefined ||
    thread.selection?.endIndex === undefined
  ) {
    return null;
  }
  return thread.message.content.slice(
    thread.selection.startIndex as number,
    thread.selection.endIndex as number,
  );
};

export const ThreadsBottomSheet: React.FC<ThreadsBottomSheetProps> = ({
  visible,
  onClose,
  reviewId,
  reviewOwnerId,
  onThreadPress,
  onAddReactionPress,
  onReplyPress,
  onCommentsChanged,
}) => {
  const {t} = useTranslate();
  const {userData} = useUser();
  const insets = useSafeAreaInsets();

  const [tabIndex, setTabIndex] = useState(0);
  const indicatorLeft = useRef(new Animated.Value(0)).current;
  const tabBarWidth = useRef(0);

  const handleTabBarLayout = useCallback(
    (e: LayoutChangeEvent) => {
      tabBarWidth.current = e.nativeEvent.layout.width;
      indicatorLeft.setValue(
        (tabIndex * e.nativeEvent.layout.width) / TAB_COUNT,
      );
    },
    [indicatorLeft, tabIndex],
  );

  const handleTabChange = useCallback(
    (idx: number) => {
      setTabIndex(idx);
      const targetLeft = (idx * tabBarWidth.current) / TAB_COUNT;
      Animated.timing(indicatorLeft, {
        toValue: targetLeft,
        duration: INDICATOR_ANIM_DURATION,
        useNativeDriver: false,
      }).start();
    },
    [indicatorLeft],
  );

  const routes = useMemo(
    () => [
      {key: 'inline' as const, title: t('ThreadsBottomSheet.tabInline')},
      {key: 'general' as const, title: t('ThreadsBottomSheet.tabGeneral')},
    ],
    [t],
  );

  const activeTab: TabKey = routes[tabIndex]?.key as TabKey;

  // --- Inline tab state ---
  const [getThreads, {data: apiData, isLoading, isFetching}] =
    useLazyGetThreadsQuery();

  const [offset, setOffset] = React.useState(0);
  const [commentsData, setCommentsData] =
    React.useState<ThreadsResponse | null>(null);
  const [hasMore, setHasMore] = React.useState(true);

  useEffect(() => {
    if (visible) {
      setOffset(0);
      setCommentsData(null);
      getThreads({reviewId, offset: 0, limit: LIMIT});
    } else {
      setCommentsData(null);
      setOffset(0);
      setTabIndex(0);
      indicatorLeft.setValue(0);
    }
  }, [visible]);

  React.useEffect(() => {
    if (apiData && visible) {
      const newThreads = apiData.data;
      if (offset === 0) {
        setCommentsData(apiData);
        setHasMore(apiData.count > LIMIT);
      } else {
        setCommentsData(prev => {
          if (!prev) {
            setHasMore(apiData.count > LIMIT);
            return apiData;
          }
          const updated = [...prev.data, ...newThreads];
          setHasMore(apiData.count > updated.length);
          return {data: updated, count: apiData.count};
        });
      }
    }
  }, [apiData, visible]);

  // --- General tab: ref for functions, state for primitive text value ---
  const generalFnRef = React.useRef({
    setCommentText: (_text: string) => {},
    onSubmitComment: (_comment: string) => {},
    isSubmitting: false,
  });
  const [generalCommentText, setGeneralCommentText] = React.useState('');

  const footerStateRef = React.useRef({
    commentText: '',
    setCommentText: (_text: string) => {},
    onSubmitComment: (_comment: string) => {},
    placeholderText: t('ThreadsBottomSheet.addComment'),
    insetsBottom: insets.bottom,
    isLoading: false,
  });

  footerStateRef.current = {
    commentText: generalCommentText,
    setCommentText: (text: string) => {
      generalFnRef.current.setCommentText(text);
      setGeneralCommentText(text);
    },
    onSubmitComment: generalFnRef.current.onSubmitComment,
    placeholderText: t('ThreadsBottomSheet.addComment'),
    insetsBottom: insets.bottom,
    isLoading: generalFnRef.current.isSubmitting,
  };

  const renderFooterComponent = React.useCallback(
    (props: BottomSheetFooterProps) => {
      const current = footerStateRef.current;
      return (
        <BottomSheetFooter
          animatedFooterPosition={props.animatedFooterPosition}
          bottomInset={0}>
          <CommentBottomSheetFooter
            text={current.commentText}
            setText={current.setCommentText}
            onSubmit={current.onSubmitComment}
            placeholder={current.placeholderText}
            bottomInset={current.insetsBottom}
            isLoading={current.isLoading}
          />
        </BottomSheetFooter>
      );
    },
    [],
  );

  // --- Tab bar ---
  const indicatorWidth = useMemo(() => {
    if (tabBarWidth.current > 0) {
      return tabBarWidth.current / TAB_COUNT;
    }
    return '50%' as unknown as number;
  }, []);

  const renderTabBar = useCallback(() => {
    return (
      <View style={styles.tabBar} onLayout={handleTabBarLayout}>
        {routes.map((route, idx) => {
          const isActive = idx === tabIndex;
          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tabBarTab}
              onPress={() => handleTabChange(idx)}
              activeOpacity={0.7}>
              <Text
                style={[
                  styles.tabBarLabel,
                  {
                    color: isActive
                      ? colors.ds.theme.primary
                      : colors.ds.typography.lowEmphasis,
                  },
                ]}>
                {route.title}
              </Text>
            </TouchableOpacity>
          );
        })}
        <Animated.View
          style={[
            styles.tabBarIndicator,
            {
              width: indicatorWidth,
              left: indicatorLeft,
            },
          ]}
        />
      </View>
    );
  }, [
    tabIndex,
    routes,
    indicatorWidth,
    indicatorLeft,
    handleTabChange,
    handleTabBarLayout,
  ]);

  // --- Inline tab renderers ---
  const renderThreadItem = useCallback(
    ({item: thread}: {item: NonNullable<typeof commentsData>['data'][0]}) => {
      if (!thread.comments || thread.comments.length === 0) {
        return null;
      }

      const firstComment = thread.comments[0];
      const remainingCount = thread.commentCount - 1 || 0;
      const reactionsArray = getReactionsArray(firstComment.reactions);
      const reactionCount = getTotalReactionCount(firstComment.reactions);

      return (
        <TouchableOpacity
          style={styles.threadContainer}
          onPress={() => onThreadPress?.(thread.id)}
          activeOpacity={0.7}>
          {thread.message?.content &&
            thread.selection?.startIndex !== undefined &&
            thread.selection?.endIndex !== undefined && (
              <View style={styles.selectedTextContainer}>
                <Text
                  style={styles.selectedText}
                  numberOfLines={1}
                  ellipsizeMode="tail">
                  {t('ThreadsBottomSheet.selectedText')} "
                  {getSelectedText(thread) || ''}"
                </Text>
              </View>
            )}

          <View style={styles.commentWrapper}>
            <ReviewComment
              name={firstComment.createdBy.name}
              time={
                firstComment.createdAt
                  ? formatRelativeTime(firstComment.createdAt)
                  : ''
              }
              comment={firstComment.content}
              profileImageUrl={firstComment.createdBy.profileImage}
              reactions={reactionsArray}
              reactionCount={reactionCount}
              replyCount={firstComment.replyCount}
              showReplyButton={false}
              disableAddReactionButton
              onCommentPress={() => onThreadPress?.(thread.id)}
              hidden={firstComment.hidden}
              currentUserId={userData?.id}
              commentOwnerId={firstComment.createdBy.id}
              commentId={firstComment.id}
            />
            {remainingCount > 0 && (
              <LinearGradient
                colors={GRADIENT_COLORS}
                start={{x: 0, y: 0}}
                end={{x: 0, y: 1}}
                locations={[0, 0.4, 0.7]}
                style={styles.gradientOverlay}
                pointerEvents="none"
              />
            )}
          </View>

          {remainingCount > 0 && (
            <>
              <View style={styles.separatorLine} />
              <View style={styles.moreCommentsContainer}>
                <Text style={styles.moreCommentsText}>
                  {remainingCount === 1
                    ? t('ThreadsBottomSheet.moreThreadsOne')
                    : t('ThreadsBottomSheet.moreThreads', {
                        count: remainingCount,
                      })}
                </Text>
                <ChevronRight
                  width={ms(20)}
                  height={ms(20)}
                  color={colors.ds.typography.mediumEmphasis}
                />
              </View>
            </>
          )}
        </TouchableOpacity>
      );
    },
    [onThreadPress, t, userData],
  );

  const renderHeader = useCallback(() => {
    return (
      <View>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {t('ThreadsBottomSheet.title')}
          </Text>
        </View>
        {renderTabBar()}
      </View>
    );
  }, [t, renderTabBar]);

  const renderInlineFooter = useCallback(() => {
    if (!isFetching) return null;
    if (!hasMore) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(120)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, hasMore]);

  const loadMore = useCallback(() => {
    if (!visible) return;
    if (isLoading || isFetching || !hasMore || !reviewId) return;
    setOffset(prevOffset => {
      const newOffset = prevOffset + LIMIT;
      getThreads({reviewId, offset: newOffset, limit: LIMIT});
      return newOffset;
    });
  }, [hasMore, reviewId, isFetching, isLoading]);

  const renderInlineEmpty = useCallback(() => {
    if (isLoading || isFetching || (visible && !commentsData)) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {t('ThreadsBottomSheet.noThreads')}
        </Text>
      </View>
    );
  }, [isLoading, isFetching, visible, commentsData, t]);

  const renderInlineTab = () => {
    if ((isLoading || isFetching) && !commentsData) {
      return renderInlineEmpty();
    }
    return (
      <BottomSheetFlatList
        data={commentsData?.data || []}
        renderItem={renderThreadItem}
        keyExtractor={item => item.id.toString()}
        ListFooterComponent={renderInlineFooter}
        ListEmptyComponent={renderInlineEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        style={styles.listStyle}
        removeClippedSubviews={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
      />
    );
  };

  const renderGeneralTab = () => {
    return (
      <GeneralCommentsList
        visible={visible && activeTab === 'general'}
        reviewId={reviewId}
        reviewOwnerId={reviewOwnerId}
        onAddReactionPress={onAddReactionPress}
        onReplyPress={onReplyPress}
        onCommentsChanged={onCommentsChanged}
        fnRef={generalFnRef}
        onCommentTextChange={setGeneralCommentText}
      />
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      skipBottomSheetView
      enableContentPanningGesture={activeTab === 'inline'}
      enableDynamicSizing={false}
      snapPoints={['80%']}
      enableOverDrag
      enableHandlePanningGesture
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      footerComponent={
        activeTab === 'general' ? renderFooterComponent : undefined
      }>
      <View style={styles.container}>
        {renderHeader()}
        {activeTab === 'inline' ? renderInlineTab() : renderGeneralTab()}
      </View>
    </BottomSheet>
  );
};

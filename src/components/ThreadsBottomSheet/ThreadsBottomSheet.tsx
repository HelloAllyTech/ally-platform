/* eslint-disable react-hooks/exhaustive-deps */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  BottomSheetFlatList,
  BottomSheetFooter,
  BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';
import {TabBar, TabView} from 'react-native-tab-view';

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

enum TABS {
  INLINE = 'INLINE',
  GENERAL = 'GENERAL',
}

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

  const layout = useWindowDimensions();
  const [tabIndex, setTabIndex] = useState(0);

  const routes = useMemo(
    () => [
      {key: TABS.INLINE, title: t('ThreadsBottomSheet.tabInline')},
      {key: TABS.GENERAL, title: t('ThreadsBottomSheet.tabGeneral')},
    ],
    [t],
  );

  const handleTabChange = useCallback((index: number) => {
    setTabIndex(index);
  }, []);

  const activeTab = routes[tabIndex]?.key as TABS;

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
  const generalFnRef = useRef({
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

  // --- Tab bar (react-native-tab-view) ---
  const renderTabBar = useCallback(
    (props: Parameters<typeof TabBar>[0]) => (
      <TabBar
        {...props}
        indicatorStyle={styles.tabBarIndicator}
        style={styles.tabBar}
        tabStyle={styles.tabBarTab}
        activeColor={colors.ds.theme.primary}
        inactiveColor={colors.ds.typography.lowEmphasis}
      />
    ),
    [],
  );

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
        visible={visible && activeTab === TABS.GENERAL}
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

  const renderScene = useCallback(
    ({route: sceneRoute}: {route: {key: string}}) => {
      switch (sceneRoute.key) {
        case TABS.INLINE:
          return renderInlineTab();
        case TABS.GENERAL:
          return renderGeneralTab();
        default:
          return null;
      }
    },
    [
      visible,
      commentsData,
      isLoading,
      isFetching,
      hasMore,
      reviewId,
      reviewOwnerId,
      activeTab,
    ],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      skipBottomSheetView
      enableContentPanningGesture
      enableDynamicSizing={false}
      snapPoints={['80%']}
      enableOverDrag
      enableHandlePanningGesture
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      failOffsetX={[-5, 5]}
      footerComponent={
        activeTab === TABS.GENERAL ? renderFooterComponent : undefined
      }>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {t('ThreadsBottomSheet.title')}
          </Text>
        </View>
        <TabView
          navigationState={{index: tabIndex, routes}}
          renderScene={renderScene}
          renderTabBar={renderTabBar}
          onIndexChange={handleTabChange}
          initialLayout={{width: layout.width}}
          swipeEnabled
          commonOptions={{labelStyle: styles.tabBarLabel}}
        />
      </View>
    </BottomSheet>
  );
};

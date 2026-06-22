/* eslint-disable react-hooks/exhaustive-deps */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
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
import {BottomSheet, ConfirmationModal, ReviewComment} from '@/components';
import {useReviewApiHooks} from '@/contexts/ReviewApiContext';
import {useStableFooterRenderer, useTranslate, useUser} from '@/hooks';
import {colors} from '@/theme';
import {Thread, ThreadsResponse} from '@/types/reviews';
import {formatRelativeTime} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {
  GeneralCommentsList,
  GeneralCommentsListRef,
} from './GeneralCommentsList';
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
  isPrivate = false,
  onClose,
  reviewId,
  reviewOwnerId,
  onThreadPress,
  onAddReactionPress,
  onReplyPress,
  onCommentsChanged,
  generalCommentsThreadId,
}) => {
  const {t} = useTranslate();
  const {userData} = useUser();
  const insets = useSafeAreaInsets();

  const layout = useWindowDimensions();
  const [tabIndex, setTabIndex] = useState(0);

  const routes = [
    {key: TABS.INLINE, title: t('threadsBottomSheet.tabInline')},
    {key: TABS.GENERAL, title: t('threadsBottomSheet.tabGeneral')},
  ];

  const handleTabChange = useCallback((index: number) => {
    setTabIndex(index);
  }, []);

  const activeTab = routes[tabIndex]?.key as TABS;

  const {useLazyGetThreads} = useReviewApiHooks();

  // --- Inline tab state ---
  const [getThreads, {isLoading, isFetching}] = useLazyGetThreads();

  const inlineOffsetRef = useRef(0);
  const [commentsData, setCommentsData] = useState<ThreadsResponse | null>(
    null,
  );
  const [hasMoreInlineThreads, setHasMoreInlineThreads] = useState(true);

  useEffect(() => {
    const fetchThreads = async () => {
      if (visible && reviewId) {
        setCommentsData(null);
        inlineOffsetRef.current = 0;
        setHasMoreInlineThreads(true);
        const result = await getThreads({
          reviewId,
          offset: 0,
          limit: LIMIT,
        });
        if (result.data) {
          setCommentsData(result.data);
          setHasMoreInlineThreads(result.data.count > LIMIT);
        }
      } else {
        setCommentsData(null);
        inlineOffsetRef.current = 0;
        setTabIndex(0);
      }
    };
    fetchThreads();
  }, [visible, reviewId]);

  // --- General tab state ---
  const generalControlRef = useRef<GeneralCommentsListRef>({
    setCommentText: () => {},
    handleSubmit: () => {},
    handleCancelDelete: () => {},
    handleConfirmDelete: () => {},
    deleteCommentId: null,
  });
  const [generalDeleteCommentId, setGeneralDeleteCommentId] = useState<
    string | null
  >(null);
  const [generalCommentText, setGeneralCommentText] = useState('');
  const [isGeneralSubmitting, setIsGeneralSubmitting] = useState(false);

  const handleSetGeneralCommentText = useCallback((text: string) => {
    setGeneralCommentText(text);
    generalControlRef.current.setCommentText(text);
  }, []);

  const handleGeneralSubmit = useCallback((text: string) => {
    generalControlRef.current.handleSubmit(text);
  }, []);

  const handleGeneralCommentTextSync = useCallback((text: string) => {
    setGeneralCommentText(text);
  }, []);

  const handleGeneralSubmittingSync = useCallback((submitting: boolean) => {
    setIsGeneralSubmitting(submitting);
  }, []);

  const generalPlaceholder = useMemo(
    () => t('threadsBottomSheet.addComment'),
    [t],
  );

  const renderGeneralFooter = useStableFooterRenderer({
    text: generalCommentText,
    setText: handleSetGeneralCommentText,
    onSubmit: handleGeneralSubmit,
    placeholder: generalPlaceholder,
    insetsBottom: insets.bottom,
    isLoading: isGeneralSubmitting,
  });

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
                  {t('threadsBottomSheet.selectedText')} "
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
                    ? t('threadsBottomSheet.moreThreadsOne')
                    : t('threadsBottomSheet.moreThreads', {
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
    if (!hasMoreInlineThreads) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(120)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, hasMoreInlineThreads]);

  const loadMoreInlineThreads = useCallback(async () => {
    if (
      !visible ||
      isLoading ||
      isFetching ||
      !hasMoreInlineThreads ||
      !reviewId
    )
      return;
    const newOffset = inlineOffsetRef.current + LIMIT;
    inlineOffsetRef.current = newOffset;
    const result = await getThreads({
      reviewId,
      offset: newOffset,
      limit: LIMIT,
    });
    const responseData = result.data;
    if (responseData) {
      setCommentsData(prev => {
        if (!prev) {
          setHasMoreInlineThreads(responseData.count > LIMIT);
          return responseData;
        }
        const updated = [...prev.data, ...responseData.data];
        setHasMoreInlineThreads(responseData.count > updated.length);
        return {data: updated, count: responseData.count};
      });
    }
  }, [
    visible,
    hasMoreInlineThreads,
    reviewId,
    isFetching,
    isLoading,
    getThreads,
  ]);

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
          {t('threadsBottomSheet.noThreads')}
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
        onEndReached={loadMoreInlineThreads}
        onEndReachedThreshold={0.5}
      />
    );
  };

  const renderGeneralTab = () => {
    return (
      <GeneralCommentsList
        isPrivate={isPrivate}
        visible={visible && activeTab === TABS.GENERAL}
        reviewId={reviewId}
        reviewOwnerId={reviewOwnerId}
        onAddReactionPress={onAddReactionPress}
        onReplyPress={onReplyPress}
        onCommentsChanged={onCommentsChanged}
        generalCommentsThreadId={generalCommentsThreadId}
        controlRef={generalControlRef}
        onDeleteCommentIdChange={setGeneralDeleteCommentId}
        onCommentTextChange={handleGeneralCommentTextSync}
        onSubmittingChange={handleGeneralSubmittingSync}
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
      hasMoreInlineThreads,
      reviewId,
      reviewOwnerId,
      activeTab,
    ],
  );

  return (
    <>
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
          activeTab === TABS.GENERAL ? renderGeneralFooter : undefined
        }>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {t('threadsBottomSheet.title')}
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
      <ConfirmationModal
        visible={!!generalDeleteCommentId}
        onClose={() => generalControlRef.current.handleCancelDelete()}
        onConfirm={generalControlRef.current.handleConfirmDelete}
        title={t('threadsBottomSheet.deleteConfirmation.title')}
        description={t('threadsBottomSheet.deleteConfirmation.description')}
        confirmLabel={t('threadsBottomSheet.deleteConfirmation.confirm')}
        cancelLabel={t('threadsBottomSheet.deleteConfirmation.cancel')}
        confirmVariant="destructive"
      />
    </>
  );
};

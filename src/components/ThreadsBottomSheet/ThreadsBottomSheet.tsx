/* eslint-disable react-hooks/exhaustive-deps */
import React, {useCallback, useEffect} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {ChevronRight} from '@/assets/icons';
import {BottomSheet, ReviewComment} from '@/components';
import {useTranslate, useUser} from '@/hooks';
import {useLazyGetThreadsQuery} from '@/services/reviewThreadsApi';
import {colors} from '@/theme';
import {ThreadsResponse} from '@/types/reviews';
import {formatRelativeTime} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {styles} from './styles';
import {ThreadsBottomSheetProps} from './types';

const LIMIT = 20;

export const ThreadsBottomSheet: React.FC<ThreadsBottomSheetProps> = ({
  visible,
  onClose,
  reviewId,
  reviewOwnerId,
  onThreadPress,
}) => {
  const {t} = useTranslate();
  const {userData} = useUser();
  const insets = useSafeAreaInsets();
  const [getThreads, {data: apiData, isLoading, isFetching}] =
    useLazyGetThreadsQuery();

  const [offset, setOffset] = React.useState(0);
  const [commentsData, setCommentsData] =
    React.useState<ThreadsResponse | null>(null);
  const [hasMore, setHasMore] = React.useState(true);

  // Reset offset and data when bottom sheet becomes visible
  useEffect(() => {
    if (visible) {
      setOffset(0);
      setCommentsData(null);
      getThreads({
        reviewId,
        offset: 0,
        limit: LIMIT,
      });
    } else {
      setCommentsData(null);
      setOffset(0);
    }
  }, [visible]);

  // Accumulate API data for pagination
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
            // If prev is null, just use the new apiData directly
            return apiData;
          }
          const updated = [...prev.data, ...newThreads];
          setHasMore(apiData.count > updated.length);
          return {data: updated, count: apiData.count};
        });
      }
    }
  }, [apiData, visible]);

  const renderThreadItem = useCallback(
    ({item: thread}: {item: NonNullable<typeof commentsData>['data'][0]}) => {
      if (!thread.comments || thread.comments.length === 0) {
        return null;
      }

      const firstComment = thread.comments[0];
      const remainingCount = thread.comments.length - 1;
      const reactionsArray = getReactionsArray(firstComment.reactions);
      const reactionCount = getTotalReactionCount(firstComment.reactions);

      return (
        <TouchableOpacity
          style={styles.threadContainer}
          onPress={() => onThreadPress?.(thread.id)}
          activeOpacity={0.7}>
          {/* Selected Text Section - if available */}
          {thread.message?.content && (
            <View style={styles.selectedTextContainer}>
              <Text
                style={styles.selectedText}
                numberOfLines={1}
                ellipsizeMode="tail">
                {t('ThreadsBottomSheet.selectedText')} "
                {thread.message?.content}"
              </Text>
            </View>
          )}

          {/* First Comment */}
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
                colors={[
                  colors.whiteTransparent0,
                  colors.whiteTransparent40,
                  colors.whiteTransparent60,
                ]}
                start={{x: 0, y: 0}}
                end={{x: 0, y: 1}}
                locations={[0, 0.4, 0.7]}
                style={styles.gradientOverlay}
                pointerEvents="none"
              />
            )}
          </View>

          {/* More Comments Indicator */}
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('ThreadsBottomSheet.title')}</Text>
      </View>
    );
  }, [t]);

  const renderFooter = useCallback(() => {
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
    if (isLoading || isFetching || !hasMore || !reviewId) {
      return;
    }
    setOffset(prevOffset => {
      const newOffset = prevOffset + LIMIT;
      getThreads({
        reviewId,
        offset: newOffset,
        limit: LIMIT,
      });
      return newOffset;
    });
  }, [hasMore, reviewId, isFetching, isLoading]);

  const renderEmpty = useCallback(() => {
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

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      initialSnapPoint={80}
      allowFullExpand
      skipBottomSheetView
      enableContentPanningGesture
      enableDynamicSizing
      enableOverDrag
      enableHandlePanningGesture>
      <View style={styles.container}>
        {(isLoading || isFetching) && !commentsData ? (
          <>
            {renderHeader()}
            {renderEmpty()}
          </>
        ) : (
          <BottomSheetFlatList
            data={commentsData?.data || []}
            renderItem={renderThreadItem}
            keyExtractor={item => item.id.toString()}
            ListHeaderComponent={renderHeader}
            ListFooterComponent={renderFooter}
            ListEmptyComponent={renderEmpty}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            style={styles.listStyle}
            removeClippedSubviews={false}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
          />
        )}
      </View>
    </BottomSheet>
  );
};

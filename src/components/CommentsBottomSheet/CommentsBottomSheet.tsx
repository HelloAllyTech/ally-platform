import React, {useCallback, useEffect} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {ChevronRight} from '@/assets/icons';
import {BottomSheet, ReviewComment} from '@/components';
import {useTranslate} from '@/hooks';
import {useLazyGetThreadsQuery} from '@/services/reviewThreadsApi';
import {colors} from '@/theme';
import {ThreadsResponse} from '@/types/reviews';
import {formatRelativeTime} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {styles} from './styles';
import {CommentsBottomSheetProps} from './types';

const LIMIT = 3;

export const CommentsBottomSheet: React.FC<CommentsBottomSheetProps> = ({
  visible,
  onClose,
  reviewId,
  onCommentPress,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const [getThreads, {data: apiData, isLoading, isFetching}] =
    useLazyGetThreadsQuery();

  const [offset, setOffset] = React.useState(0);
  const [commentsData, setCommentsData] =
    React.useState<ThreadsResponse | null>(null);

  // Reset offset and data when bottom sheet becomes visible
  useEffect(() => {
    if (visible && reviewId) {
      setOffset(0);
      setCommentsData(null);
      getThreads({
        reviewId,
        offset: 0,
        limit: LIMIT,
      });
    }
  }, [visible, reviewId, getThreads]);

  // Accumulate API data for pagination
  React.useEffect(() => {
    if (apiData) {
      if (offset === 0) {
        // First page - replace data
        setCommentsData({data: apiData.data, count: apiData.count});
      } else {
        // Subsequent pages - append data
        setCommentsData(prev => {
          if (!prev) return apiData;
          return {
            data: [...prev.data, ...apiData.data],
            count: apiData.count,
          };
        });
      }
    }
  }, [apiData, offset]);

  const renderThreadItem = useCallback(
    ({item: thread}: {item: NonNullable<typeof commentsData>['data'][0]}) => {
      if (!thread.comments || thread.comments.length === 0) {
        return null;
      }

      const firstComment = thread.comments[0];
      const remainingCount = thread.commentCount - 1;
      const reactionsArray = getReactionsArray(firstComment.reactions);
      const reactionCount = getTotalReactionCount(firstComment.reactions);

      return (
        <TouchableOpacity
          style={styles.threadContainer}
          onPress={() => onCommentPress?.(thread.id)}
          activeOpacity={0.7}>
          {/* Selected Text Section - if available */}
          {thread.selectedText && (
            <View style={styles.selectedTextContainer}>
              <Text
                style={styles.selectedText}
                numberOfLines={1}
                ellipsizeMode="tail">
                {t('CommentsBottomSheet.selectedText')} "{thread.selectedText}"
              </Text>
            </View>
          )}

          {/* First Comment */}
          <View style={styles.commentWrapper}>
            <ReviewComment
              name={firstComment.createdBy.name}
              time={formatRelativeTime(firstComment.createdAt)}
              comment={firstComment.content}
              profileImageUrl={firstComment.createdBy.profileImage}
              reactions={reactionsArray}
              reactionCount={reactionCount}
              replyCount={firstComment.replyCount}
              showReplyButton={false}
              onCommentPress={() => onCommentPress?.(thread.id)}
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
                    ? t('CommentsBottomSheet.moreCommentsOne')
                    : t('CommentsBottomSheet.moreComments', {
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
    [onCommentPress, t],
  );

  const renderHeader = useCallback(() => {
    return (
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('CommentsBottomSheet.title')}</Text>
      </View>
    );
  }, [t]);

  const renderFooter = useCallback(() => {
    if (!isFetching) return null;
    const hasMore = commentsData && offset + LIMIT < commentsData.count;
    if (!hasMore) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(120)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, commentsData, offset]);

  const loadMore = useCallback(() => {
    if (
      !isFetching &&
      commentsData &&
      offset + LIMIT < commentsData.count &&
      reviewId
    ) {
      const newOffset = offset + LIMIT;
      setOffset(newOffset);
      getThreads({
        reviewId,
        offset: newOffset,
        limit: LIMIT,
      });
    }
  }, [offset, isFetching, commentsData, reviewId, getThreads]);

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {t('CommentsBottomSheet.noComments')}
        </Text>
      </View>
    );
  }, [isLoading, t]);

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
        {isLoading && !commentsData ? (
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
            onEndReachedThreshold={0.3}
          />
        )}
      </View>
    </BottomSheet>
  );
};

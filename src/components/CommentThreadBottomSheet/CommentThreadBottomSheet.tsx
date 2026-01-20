import React, {useCallback, useEffect, useState} from 'react';
import {BottomSheetFlatList, BottomSheetTextInput} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {LeftArrow, LeftArrowIcon} from '@/assets/icons';
import {BottomSheet, ReviewComment} from '@/components';
import {useTranslate} from '@/hooks';
import {useLazyGetThreadCommentsQuery} from '@/services/reviewThreadsApi';
import {colors} from '@/theme';
import {MessageThreadComment} from '@/types/reviews';
import {formatRelativeTime} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {styles} from './styles';
import {CommentThreadBottomSheetProps} from './types';

const LIMIT = 20;

export const CommentThreadBottomSheet: React.FC<
  CommentThreadBottomSheetProps
> = ({
  visible,
  onClose,
  threadId,
  onAddReactionPress,
  onReplyPress,
  onSubmitComment,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const [getThreadComments, {data: apiData, isLoading, isFetching}] =
    useLazyGetThreadCommentsQuery();
  const [offset, setOffset] = React.useState(0);
  const [comments, setComments] = React.useState<{
    data: MessageThreadComment[];
    count: number;
  } | null>(null);
  const [commentText, setCommentText] = useState('');

  // Reset offset and data when bottom sheet becomes visible
  useEffect(() => {
    if (visible && threadId) {
      setOffset(0);
      setComments(null);
      getThreadComments({
        threadId,
        offset: 0,
        limit: LIMIT,
      });
    }
  }, [visible, threadId, getThreadComments]);

  // Accumulate API data for pagination
  React.useEffect(() => {
    if (apiData) {
      if (offset === 0) {
        // First page - replace data
        setComments({data: apiData.data, count: apiData.count});
      } else {
        // Subsequent pages - append data, avoiding duplicates
        setComments(prev => {
          if (!prev) return {data: apiData.data, count: apiData.count};
          const existingIds = new Set(prev.data.map(item => String(item.id)));
          const newItems = apiData.data.filter(
            item => !existingIds.has(String(item.id)),
          );
          return {
            data: [...prev.data, ...newItems],
            count: apiData.count,
          };
        });
      }
    }
  }, [apiData, offset]);

  const handleReplyPress = useCallback(
    (comment: MessageThreadComment) => {
      onReplyPress?.(comment);
    },
    [onReplyPress],
  );

  const renderCommentItem = useCallback(
    ({item: comment}: {item: MessageThreadComment}) => {
      const reactionsArray = getReactionsArray(comment.reactions);
      const reactionCount = getTotalReactionCount(comment.reactions);

      return (
        <View style={styles.commentItemContainer}>
          <ReviewComment
            name={comment.createdBy.name}
            time={formatRelativeTime(comment.createdAt)}
            comment={comment.content}
            profileImageUrl={comment.createdBy.profileImage}
            reactions={reactionsArray}
            reactionCount={reactionCount}
            replyCount={comment.replyCount}
            showReplyButton
            onAddReactionPress={() => onAddReactionPress?.(comment.id)}
            onReplyPress={() => handleReplyPress(comment)}
          />
        </View>
      );
    },
    [onAddReactionPress, handleReplyPress],
  );

  const renderHeader = useCallback(() => {
    return (
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onClose}
          activeOpacity={0.7}>
          <LeftArrow
            width={ms(12)}
            height={ms(15)}
            color={colors.ds.typography.highEmphasis}
          />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('CommentThreadBottomSheet.title')}
        </Text>
      </View>
    );
  }, [onClose, t]);

  const renderFooter = useCallback(() => {
    if (!isFetching) return null;
    const hasMore = comments && offset + LIMIT < comments.count;
    if (!hasMore) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(120)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, comments, offset]);

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
          {t('CommentThreadBottomSheet.noComments')}
        </Text>
      </View>
    );
  }, [isLoading, t]);

  const loadMore = useCallback(() => {
    if (
      !isFetching &&
      comments &&
      offset + LIMIT < comments.count &&
      threadId
    ) {
      const newOffset = offset + LIMIT;
      setOffset(newOffset);
      getThreadComments({
        threadId,
        offset: newOffset,
        limit: LIMIT,
      });
    }
  }, [offset, isFetching, comments, threadId, getThreadComments]);

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        allowFullExpand
        skipBottomSheetView
        enableContentPanningGesture
        enableDynamicSizing
        enableOverDrag
        enableHandlePanningGesture>
        <View style={styles.container}>
          {isLoading && !comments ? (
            <>
              {renderHeader()}
              {renderEmpty()}
            </>
          ) : (
            <>
              {renderHeader()}
              <BottomSheetFlatList
                data={comments?.data || []}
                renderItem={renderCommentItem}
                keyExtractor={item => item.id.toString()}
                ListFooterComponent={renderFooter}
                ListEmptyComponent={renderEmpty}
                contentContainerStyle={[
                  styles.listContent,
                  {paddingBottom: insets.bottom + ms(60)},
                ]}
                showsVerticalScrollIndicator={false}
                style={styles.listStyle}
                removeClippedSubviews={false}
                onEndReached={loadMore}
                onEndReachedThreshold={0.3}
              />
              {/* Add Comment Input - Always visible at bottom */}
              <View
                style={[
                  styles.addCommentContainer,
                  {paddingBottom: insets.bottom},
                ]}>
                <View style={styles.addCommentInputContainer}>
                  <BottomSheetTextInput
                    style={styles.addCommentInput}
                    placeholder={t('CommentThreadBottomSheet.addComment')}
                    placeholderTextColor={colors.ds.typography.mediumEmphasis}
                    value={commentText}
                    onChangeText={setCommentText}
                    multiline={false}
                  />
                  <TouchableOpacity
                    style={[
                      styles.sendButton,
                      !commentText.trim() && styles.sendButtonDisabled,
                    ]}
                    onPress={() => {
                      if (commentText.trim()) {
                        onSubmitComment?.(commentText);
                        setCommentText('');
                      }
                    }}
                    disabled={!commentText.trim()}
                    activeOpacity={0.7}>
                    <LeftArrowIcon
                      color={colors.white}
                      width={'32@ms'}
                      height={'32@ms'}
                      style={styles.arrowIcon}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </View>
      </BottomSheet>
    </>
  );
};

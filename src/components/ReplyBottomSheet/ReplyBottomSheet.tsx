import React, {useCallback, useEffect, useState} from 'react';
import {BottomSheetFlatList, BottomSheetTextInput} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {LeftArrow, LeftArrowIcon} from '@/assets/icons';
import {BottomSheet, ReviewComment} from '@/components';
import {useTranslate} from '@/hooks';
import {useLazyGetCommentRepliesQuery} from '@/services/reviewThreadsApi';
import {colors} from '@/theme';
import {MessageThreadComment} from '@/types/reviews';
import {formatRelativeTime} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {styles} from './styles';
import {ReplyBottomSheetProps} from './types';

const LIMIT = 20;

export const ReplyBottomSheet: React.FC<ReplyBottomSheetProps> = ({
  visible,
  onClose,
  commentId,
  originalComment,
  onAddReactionPress,
  onReplyPress,
  onAddReplyPress,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const [getCommentReplies, {data: apiData, isLoading, isFetching}] =
    useLazyGetCommentRepliesQuery();
  const [offset, setOffset] = React.useState(0);
  const [replies, setReplies] = React.useState<{
    data: MessageThreadComment[];
    count: number;
  } | null>(null);
  const [replyText, setReplyText] = useState('');

  // Reset offset and data when bottom sheet becomes visible
  useEffect(() => {
    if (visible && commentId && originalComment) {
      setOffset(0);
      setReplies(null);
      getCommentReplies({
        commentId,
        offset: 0,
        limit: LIMIT,
      });
    }
  }, [visible, commentId, originalComment, getCommentReplies]);

  // Accumulate API data for pagination
  React.useEffect(() => {
    if (apiData) {
      if (offset === 0) {
        setReplies({data: apiData.data, count: apiData.count});
      } else {
        setReplies(prev => {
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

  const renderReplyItem = useCallback(
    ({item: reply}: {item: MessageThreadComment}) => {
      const reactionsArray = getReactionsArray(reply.reactions);
      const reactionCount = getTotalReactionCount(reply.reactions);

      return (
        <View style={styles.replyItemContainer}>
          <ReviewComment
            name={reply.createdBy.name}
            time={formatRelativeTime(reply.createdAt)}
            comment={reply.content}
            profileImageUrl={reply.createdBy.profileImage}
            reactions={reactionsArray}
            reactionCount={reactionCount}
            replyCount={0}
            showReplyButton
            onAddReactionPress={() => onAddReactionPress?.(reply.id)}
            onReplyPress={() => onReplyPress?.(reply.id)}
          />
        </View>
      );
    },
    [onAddReactionPress, onReplyPress],
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
        <Text style={styles.headerTitle}>{t('ReplyBottomSheet.title')}</Text>
      </View>
    );
  }, [onClose, t]);

  const renderOriginalComment = useCallback(() => {
    if (!originalComment) return null;

    const reactionsArray = getReactionsArray(originalComment.reactions);
    const reactionCount = getTotalReactionCount(originalComment.reactions);

    return (
      <View style={styles.originalCommentContainer}>
        <ReviewComment
          name={originalComment.createdBy.name}
          time={formatRelativeTime(originalComment.createdAt)}
          comment={originalComment.content}
          profileImageUrl={originalComment.createdBy.profileImage}
          reactions={reactionsArray}
          reactionCount={reactionCount}
          replyCount={0}
          showReplyButton
          onAddReactionPress={() => onAddReactionPress?.(originalComment.id)}
        />
      </View>
    );
  }, [originalComment, onAddReactionPress]);

  const renderFooter = useCallback(() => {
    if (!isFetching && !replies?.data.length) return null;
    const hasMore = replies && offset + LIMIT < replies.count;
    if (!hasMore) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(100)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, replies, offset]);

  const loadMore = useCallback(() => {
    if (!isFetching && replies && offset + LIMIT < replies.count && commentId) {
      const newOffset = offset + LIMIT;
      setOffset(newOffset);
      getCommentReplies({
        commentId,
        offset: newOffset,
        limit: LIMIT,
      });
    }
  }, [offset, isFetching, replies, commentId, getCommentReplies]);

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
        <Text style={styles.emptyText}>{t('ReplyBottomSheet.noReplies')}</Text>
      </View>
    );
  }, [isLoading, t]);

  return (
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
        {isLoading && !replies ? (
          <>
            {renderHeader()}
            {renderEmpty()}
          </>
        ) : (
          <>
            {renderHeader()}
            {renderOriginalComment()}
            <BottomSheetFlatList
              data={replies?.data || []}
              renderItem={renderReplyItem}
              keyExtractor={item => item.id.toString()}
              ListFooterComponent={renderFooter}
              ListEmptyComponent={renderEmpty}
              contentContainerStyle={[
                styles.listContent,
                {paddingBottom: insets.bottom + ms(100)},
              ]}
              showsVerticalScrollIndicator={false}
              style={styles.listStyle}
              removeClippedSubviews={false}
              onEndReached={loadMore}
              onEndReachedThreshold={0.3}
            />
            <View
              style={[
                styles.addReplyContainer,
                {paddingBottom: insets.bottom + 16},
              ]}>
              <View style={styles.addReplyInputContainer}>
                <BottomSheetTextInput
                  style={styles.addReplyInput}
                  placeholder={t('ReplyBottomSheet.addReply')}
                  placeholderTextColor={colors.ds.typography.mediumEmphasis}
                  value={replyText}
                  onChangeText={setReplyText}
                  multiline={false}
                />
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    !replyText.trim() && styles.sendButtonDisabled,
                  ]}
                  onPress={() => {
                    if (replyText.trim()) {
                      onAddReplyPress?.(replyText);
                      setReplyText('');
                    }
                  }}
                  disabled={!replyText.trim()}
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
  );
};

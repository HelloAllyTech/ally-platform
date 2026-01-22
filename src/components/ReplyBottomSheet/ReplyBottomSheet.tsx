import React, {useCallback, useEffect, useRef, useState} from 'react';
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
  onSubmitReplyPress,
  hideReplyBottomSheet,
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
  const [hasMore, setHasMore] = React.useState(false);
  const [replyText, setReplyText] = useState('');
  const isLoadingRef = useRef(false);

  // Reset offset and data when bottom sheet becomes visible
  useEffect(() => {
    if (visible && commentId && originalComment) {
      setOffset(0);
      setReplies(null);
      setHasMore(false);
      isLoadingRef.current = false;
      getCommentReplies({
        commentId,
        offset: 0,
        limit: LIMIT,
      });
    }
  }, [visible, commentId, originalComment, getCommentReplies]);

  // Process data only if it's for a new offset
  React.useEffect(() => {
    if (apiData && visible) {
      const newReplies = apiData.data;

      setReplies(prev => {
        const updated = prev
          ? {data: [...prev.data, ...newReplies], count: apiData.count}
          : apiData;
        if (updated.data.length >= apiData.count) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }
        return updated;
      });
      isLoadingRef.current = false;
    }
  }, [apiData, visible]);

  // Update loading ref
  useEffect(() => {
    isLoadingRef.current = isLoading || isFetching;
  }, [isLoading, isFetching]);

  const renderReplyItem = useCallback(
    ({item: reply}: {item: MessageThreadComment}) => {
      const reactionsArray = getReactionsArray(reply.reactions);
      const reactionCount = getTotalReactionCount(reply.reactions);

      return (
        <View style={styles.replyItemContainer}>
          <ReviewComment
            name={reply.createdBy.name}
            time={reply.createdAt ? formatRelativeTime(reply.createdAt) : ''}
            comment={reply.content}
            profileImageUrl={reply.createdBy.profileImage}
            reactions={reactionsArray}
            reactionCount={reactionCount}
            replyCount={0}
            showReplyButton={false}
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
          onPress={hideReplyBottomSheet}
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
  }, [hideReplyBottomSheet, t]);

  const renderOriginalComment = useCallback(() => {
    if (!originalComment) return null;

    const reactionsArray = getReactionsArray(originalComment.reactions);
    const reactionCount = getTotalReactionCount(originalComment.reactions);

    return (
      <View style={styles.originalCommentContainer}>
        <ReviewComment
          name={originalComment.createdBy.name}
          time={
            originalComment.createdAt
              ? formatRelativeTime(originalComment.createdAt)
              : ''
          }
          comment={originalComment.content}
          profileImageUrl={originalComment.createdBy.profileImage}
          reactions={reactionsArray}
          reactionCount={reactionCount}
          replyCount={0}
          showReplyButton={false}
          onAddReactionPress={() => onAddReactionPress?.(originalComment.id)}
        />
      </View>
    );
  }, [originalComment, onAddReactionPress]);

  const renderFooter = useCallback(() => {
    if (!isFetching) return null;
    if (!hasMore) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(100)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, hasMore]);

  const loadMore = useCallback(() => {
    if (!visible) return;
    if (isLoadingRef.current || !hasMore || !commentId) {
      return;
    }

    isLoadingRef.current = true;
    setOffset(prevOffset => {
      const newOffset = prevOffset + LIMIT;
      getCommentReplies({
        commentId,
        offset: newOffset,
        limit: LIMIT,
      });
      return newOffset;
    });
  }, [hasMore, commentId, getCommentReplies, visible]);

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }
    return <View style={styles.emptyContainer} />;
  }, [isLoading]);

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
                  {paddingBottom: insets.bottom + ms(200)},
                ]}
                showsVerticalScrollIndicator={false}
                style={styles.listStyle}
                removeClippedSubviews={false}
                onEndReached={loadMore}
                onEndReachedThreshold={0.3}
                scrollEnabled={false}
              />
              <View
                style={[
                  styles.addReplyContainer,
                  {paddingBottom: insets.bottom},
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
                        onSubmitReplyPress?.(replyText);
                        setReplyText('');
                      }
                    }}
                    disabled={!replyText.trim()}
                    activeOpacity={0.7}>
                    <LeftArrowIcon
                      color={colors.white}
                      width={32}
                      height={32}
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

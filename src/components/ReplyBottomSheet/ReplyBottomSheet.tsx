import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  BottomSheetFlatList,
  BottomSheetFooter,
  BottomSheetFooterProps,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
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

// Memoized footer content to prevent remounting while allowing re-renders
const FooterContent = React.memo<{
  replyText: string;
  setReplyText: (text: string) => void;
  onSubmitReplyPress?: (text: string) => void;
  placeholder: string;
}>(({replyText, setReplyText, onSubmitReplyPress, placeholder}) => {
  return (
    <View style={[styles.addReplyContainer, {paddingTop: ms(20)}]}>
      <View style={styles.addReplyInputContainer}>
        <BottomSheetTextInput
          style={styles.addReplyInput}
          placeholder={placeholder}
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
  );
});

FooterContent.displayName = 'FooterContent';

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
  const [getCommentReplies, {isLoading, isFetching}] =
    useLazyGetCommentRepliesQuery();
  const offsetRef = useRef(0);
  const [replies, setReplies] = React.useState<{
    data: MessageThreadComment[];
    count: number;
  } | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [replyText, setReplyText] = useState('');
  const currentCommentIdRef = useRef<string>('');

  // Common function to handle API response and update state
  const handleApiResponse = useCallback(
    (
      responseData: {data: MessageThreadComment[]; count: number} | undefined,
      responseCommentId: string,
    ) => {
      if (!responseData || responseCommentId !== commentId) {
        return;
      }

      const newReplies = responseData.data;

      setReplies(prev => {
        const updated = prev
          ? {data: [...prev.data, ...newReplies], count: responseData.count}
          : responseData;
        if (updated.data.length >= responseData.count) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }
        return updated;
      });
    },
    [commentId],
  );

  // Reset offset and data when bottom sheet becomes visible
  useEffect(() => {
    const fetchReplies = async () => {
      if (visible && commentId && originalComment) {
        offsetRef.current = 0;
        setReplies(null);
        setHasMore(false);
        currentCommentIdRef.current = commentId;
        const result = await getCommentReplies({
          commentId,
          offset: 0,
          limit: LIMIT,
        });
        if (result.data) {
          handleApiResponse(result.data, commentId);
        }
      } else {
        setReplies(null);
        offsetRef.current = 0;
        setHasMore(false);
        currentCommentIdRef.current = '';
      }
    };

    fetchReplies();
  }, [
    visible,
    commentId,
    originalComment,
    getCommentReplies,
    handleApiResponse,
  ]);

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
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(30)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom, hasMore]);

  const loadMore = useCallback(async () => {
    if (!visible) return;
    if (isLoading || !hasMore || !commentId) {
      return;
    }
    const newOffset = offsetRef.current + LIMIT;
    offsetRef.current = newOffset;
    const result = await getCommentReplies({
      commentId,
      offset: newOffset,
      limit: LIMIT,
    });
    if (result.data) {
      handleApiResponse(result.data, commentId);
    }
  }, [
    hasMore,
    commentId,
    getCommentReplies,
    visible,
    handleApiResponse,
    isLoading,
  ]);

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

  const placeholderText = useMemo(() => t('ReplyBottomSheet.addReply'), [t]);

  // Store current values in refs - updated synchronously on every render
  const stateRef = React.useRef({
    replyText,
    setReplyText,
    onSubmitReplyPress,
    placeholderText,
    insetsBottom: insets.bottom,
  });

  // Update ref synchronously (not in useEffect) to ensure current values
  stateRef.current = {
    replyText,
    setReplyText,
    onSubmitReplyPress,
    placeholderText,
    insetsBottom: insets.bottom,
  };

  // Completely stable callback - reference never changes
  // Reads current values from ref (updated synchronously above)
  const renderFooterComponent = React.useCallback(
    (props: BottomSheetFooterProps) => {
      // Read from ref - always has current values due to synchronous update above
      const current = stateRef.current;
      return (
        <BottomSheetFooter
          animatedFooterPosition={props.animatedFooterPosition}
          bottomInset={current.insetsBottom}>
          <FooterContent
            replyText={current.replyText}
            setReplyText={current.setReplyText}
            onSubmitReplyPress={current.onSubmitReplyPress}
            placeholder={current.placeholderText}
          />
        </BottomSheetFooter>
      );
    },
    [], // Empty deps - callback reference never changes
  );

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
        enableHandlePanningGesture
        footerComponent={renderFooterComponent}>
        <View style={styles.container}>
          {isLoading && !replies ? (
            <>
              {renderHeader()}
              {renderEmpty()}
            </>
          ) : (
            <View style={styles.contentWrapper}>
              {renderHeader()}
              {renderOriginalComment()}
              <View style={styles.listWrapper}>
                <BottomSheetFlatList
                  data={replies?.data || []}
                  renderItem={renderReplyItem}
                  keyExtractor={item => item.id.toString()}
                  ListFooterComponent={renderFooter}
                  ListEmptyComponent={renderEmpty}
                  contentContainerStyle={[
                    styles.listContent,
                    {paddingBottom: ms(150)},
                  ]}
                  showsVerticalScrollIndicator={false}
                  style={styles.listStyle}
                  removeClippedSubviews={false}
                  onEndReached={loadMore}
                  onEndReachedThreshold={0.3}
                />
              </View>
            </View>
          )}
        </View>
      </BottomSheet>
    </>
  );
};

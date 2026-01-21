import React, {useCallback} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {BottomSheet, ReviewComment} from '@/components';
import {colors} from '@/theme';
import {MessageThread} from '@/types/reviews';
import {formatRelativeTime} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {styles} from './styles';

export interface MessageThreadsBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  messageId: string;
  reviewId: string;
  threads: MessageThread[];
  onThreadPress?: (threadId: string) => void;
}

export const MessageThreadsBottomSheet: React.FC<
  MessageThreadsBottomSheetProps
> = ({visible, onClose, messageId, reviewId, threads = [], onThreadPress}) => {
  const insets = useSafeAreaInsets();
  const isLoading = false;

  const renderThreadItem = useCallback(
    ({item}: {item: MessageThread}) => {
      const selectedText = (item.selection as any)?.selectedText || '';
      const commentsCount = item.comments?.length || 0;
      const firstComment = item.comments?.[0];
      const reactionsArray = getReactionsArray(firstComment?.reactions);
      const reactionCount = getTotalReactionCount(firstComment?.reactions);

      // Build comment text with selected text context
      const commentText = selectedText
        ? `"${selectedText}"\n\n${firstComment?.content || ''}`
        : firstComment?.content || '';

      return (
        <View style={styles.commentItemContainer}>
          <ReviewComment
            name={item.createdBy?.name || 'Unknown User'}
            time={
              firstComment?.createdAt
                ? formatRelativeTime(firstComment.createdAt)
                : ''
            }
            comment={commentText}
            profileImageUrl={item.createdBy?.profileImage}
            reactions={reactionsArray}
            reactionCount={reactionCount}
            replyCount={commentsCount > 1 ? commentsCount - 1 : 0}
            showReplyButton={false}
            onCommentPress={() => onThreadPress?.(item.id)}
          />
        </View>
      );
    },
    [onThreadPress],
  );

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No threads found for this message</Text>
      </View>
    );
  }, [isLoading]);

  const keyExtractor = useCallback(
    (item: MessageThread, index: number) => `${item.id}-${index}`,
    [],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      initialSnapPoint={60}
      allowFullExpand
      enablePanDownToClose
      showHandle
      skipBottomSheetView>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Message Threads</Text>
        <Text style={styles.headerSubtitle}>
          Tap a thread to view all comments
        </Text>
      </View>

      <BottomSheetFlatList
        data={threads}
        renderItem={renderThreadItem}
        keyExtractor={keyExtractor}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[
          styles.contentContainer,
          {paddingBottom: insets.bottom},
        ]}
        showsVerticalScrollIndicator={false}
      />
    </BottomSheet>
  );
};

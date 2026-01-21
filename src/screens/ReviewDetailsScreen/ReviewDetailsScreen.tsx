import {useCallback, useEffect, useState} from 'react';
import {useRoute} from '@react-navigation/native';
import {ActivityIndicator, SafeAreaView, StyleSheet, View} from 'react-native';

import {
  CommentInput,
  CommentThreadBottomSheet,
  Conversation,
  ReplyBottomSheet,
  ThreadsBottomSheet,
} from '@/components';
import {InteractionsBar} from '@/components/ReviewTranscriptHeader/InteractionsBar';
import {
  useAddReviewCommentMutation,
  useGetMessagesQuery,
} from '@/services/reviewsApi';
import {colors} from '@/theme';
import {MessageData, TextSelection} from '@/types/reviews';
import {splitByCommentRanges} from '@/utils/reviews';

import {useReviewComments} from './hooks/useReviewComments';

const MESSAGES_PER_PAGE = 10;

export const ReviewDetailsScreen: React.FC = () => {
  const isSelectable = true;
  // Assume the route params contain reviewId
  const route = useRoute<any>();
  const {reviewId: _reviewId} = route.params || {};

  // Pagination state
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const {
    data: messagesData,
    isLoading,
    isFetching,
    isError,
  } = useGetMessagesQuery(
    {reviewId: _reviewId, offset, limit: MESSAGES_PER_PAGE},
    {skip: !_reviewId},
  );

  // ADD REVIEW COMMENT API
  const [addReviewComment, {isLoading: isAddingComment}] =
    useAddReviewCommentMutation();

  const {
    isThreadsBottomSheetVisible,
    closeThreadsBottomSheet,
    onThreadPress,
    isCommentThreadBottomSheetVisible,
    closeCommentThreadBottomSheet,
    selectedThreadId,
    isReplyBottomSheetVisible,
    closeReplyBottomSheet,
    selectedComment,
    onReplyPress,
    showThreadsBottomSheet,
    hideReplyBottomSheet,
    hideCommentThreadBottomSheet,
  } = useReviewComments();

  const [comment, setComment] = useState('');
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [currentHighlightedText, setCurrentHighlightedText] =
    useState<TextSelection | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>();
  const [conversationMessages, setConversationMessages] = useState<
    MessageData[]
  >([]);

  // Update conversationMessages when new data is fetched
  useEffect(() => {
    if (messagesData?.data) {
      const newMessages = messagesData.data;
      const mappedMessages = newMessages.map(message => ({
        id: message.id,
        content: message.content,
        startSeconds: message.startSeconds,
        endSeconds: message.endSeconds,
        senderId: message.senderId,
        messagePart: splitByCommentRanges(
          message.content,
          message.threads.map(thread => ({
            id: thread.id,
            start: thread.selection.startIndex as number,
            end: thread.selection.endIndex as number,
          })),
        ),
      }));

      // If offset is 0, replace all messages (initial load or refresh)
      if (offset === 0) {
        setConversationMessages(mappedMessages as unknown as MessageData[]);
      } else {
        // Append new messages, avoiding duplicates
        setConversationMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const uniqueNewMessages = mappedMessages.filter(
            m => !existingIds.has(m.id),
          );
          return [...prev, ...uniqueNewMessages] as MessageData[];
        });
      }

      // Check if there are more messages to load
      if (newMessages.length < MESSAGES_PER_PAGE) {
        setHasMore(false);
      }
    }
  }, [messagesData, offset]);

  // Helper function to map thread ranges
  const mapThreadRanges = useCallback((threads: any[]) => {
    return threads.map(thread => ({
      id: thread.id,
      start: thread.selection.startIndex,
      end: thread.selection.endIndex,
    }));
  }, []);

  // Update a specific message with new comment thread
  const updateMessage = useCallback(
    (payload: any) => {
      const {selection, commentId, messageId} = payload;

      setConversationMessages(prev => {
        const messageIndex = prev.findIndex(m => m.id === messageId);

        if (messageIndex === -1) return prev;

        const updatedMessages = [...prev];
        const currentMessage = updatedMessages[messageIndex];

        // Get existing threads from the message
        const existingThreads =
          messagesData?.data?.find(m => m.id === messageId)?.threads || [];

        // Create new message part with updated threads
        const newMessagePart = splitByCommentRanges(currentMessage.content, [
          ...mapThreadRanges(existingThreads),
          {id: commentId, start: selection.startIndex, end: selection.endIndex},
        ]);

        updatedMessages[messageIndex] = {
          ...currentMessage,
          messagePart: newMessagePart,
        };

        return updatedMessages;
      });
    },
    [messagesData, mapThreadRanges],
  );

  // Pagination callbacks
  const loadMoreMessages = useCallback(() => {
    if (!isFetching && hasMore) {
      setOffset(prev => prev + MESSAGES_PER_PAGE);
    }
  }, [isFetching, hasMore]);

  const refreshMessages = useCallback(() => {
    setOffset(0);
    setHasMore(true);
    setConversationMessages([]);
  }, []);

  // Early returns after all hooks
  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const handleChangeComment = (text: string) => {
    setComment(text);
  };

  const handleSendComment = async () => {
    if (
      selectedMessageId &&
      comment.trim().length > 0 &&
      currentHighlightedText?.selectedText
    ) {
      try {
        const payload: {
          reviewId: string;
          messageId: string;
          selection: TextSelection;
          content: string;
          parentCommentId?: string;
          threadId?: string;
        } = {
          reviewId: _reviewId,
          messageId: selectedMessageId,
          selection: currentHighlightedText,
          content: comment,
        };

        if (selectedComment?.id) payload.parentCommentId = selectedComment?.id;

        if (selectedThreadId) payload.threadId = selectedThreadId;
        console.log('payload', payload);
        const response = await addReviewComment(payload);
        console.log('response', response);
        if (response.data) {
          updateMessage({
            ...payload,
            commentId: response.data.commentId,
          });
        }
      } catch (error) {
        // logger.error(error);
      } finally {
        resetCommentInput();
      }
    }
  };

  const handleSelection = (selection: TextSelection, messageId: string) => {
    setShowCommentInput(true);
    setCurrentHighlightedText(selection);
    setSelectedMessageId(messageId);
  };

  const resetCommentInput = () => {
    setShowCommentInput(false);
    setComment('');
    setCurrentHighlightedText(null);
    setSelectedMessageId(null);
  };

  const handleThreadClick = (threadId: string, messageId: string) => {
    if (!showCommentInput) {
      showThreadsBottomSheet();
    }
    const message = conversationMessages?.find(
      messageItem => messageItem.id === messageId,
    );
    if (message) {
      // TODO_M: Fetch thread comments and list them in bottomsheet
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Main conversation/messages view */}
      <Conversation
        messages={conversationMessages}
        isSelectable={isSelectable}
        onSelection={handleSelection}
        onThreadClick={handleThreadClick}
        onLoadMore={loadMoreMessages}
        isLoadingMore={isFetching && offset > 0}
        hasMore={hasMore}
        onRefresh={refreshMessages}
        isRefreshing={isFetching && offset === 0}
      />
      {/* Floating input at the bottom */}
      {showCommentInput && (
        <CommentInput
          onChangeText={handleChangeComment}
          onSend={handleSendComment}
          comment={comment}
          autoFocus
          onBlur={() => setShowCommentInput(false)}
          isSendButtonDisabled={comment.length === 0 || !comment.trim()}
          isLoading={isAddingComment}
        />
      )}
      <InteractionsBar
        reviewId={_reviewId}
        reactions={{}}
        commentsCount={0}
        onCommentPress={showThreadsBottomSheet}
      />
      <ThreadsBottomSheet
        visible={isThreadsBottomSheetVisible}
        onClose={closeThreadsBottomSheet}
        reviewId={_reviewId}
        onThreadPress={onThreadPress}
      />
      <CommentThreadBottomSheet
        visible={isCommentThreadBottomSheetVisible}
        onClose={closeCommentThreadBottomSheet}
        threadId={selectedThreadId || ''}
        onAddReactionPress={_commentId => {
          // Handle add reaction press
        }}
        onReplyPress={onReplyPress}
        onSubmitComment={_commentText => {
          // Handle add comment press
        }}
        hideCommentThreadBottomSheet={hideCommentThreadBottomSheet}
      />
      <ReplyBottomSheet
        visible={isReplyBottomSheetVisible}
        onClose={closeReplyBottomSheet}
        commentId={selectedComment?.id || ''}
        originalComment={selectedComment || null}
        onAddReactionPress={_commentId => {
          // Handle add reaction press
        }}
        onReplyPress={_commentId => {
          // Handle reply press
        }}
        onSubmitReplyPress={_commentText => {
          // Handle add comment press
        }}
        hideReplyBottomSheet={hideReplyBottomSheet}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.white,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ReviewDetailsScreen;

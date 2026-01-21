import {useEffect, useMemo, useState} from 'react';
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
import {useAddReviewCommentMutation} from '@/services/reviewsApi';
import {colors} from '@/theme';
import {Message, MessageData, TextSelection} from '@/types/reviews';
import {splitByCommentRanges} from '@/utils/reviews';

import {dummyConversationMessages} from './dummyConversation';
import {useReviewComments} from './hooks/useReviewComments';

export const ReviewDetailsScreen: React.FC = () => {
  const isSelectable = true;
  // Assume the route params contain reviewId
  const route = useRoute<any>();
  const {reviewId: _reviewId} = route.params;

  // TODO_M: uncomment GET MESSAGE once the API is implemented
  // const {data, isLoading, isError} = useGetMessagesQuery({reviewId});
  const isLoading = false;
  const isError = false;
  const data = useMemo(() => ({data: dummyConversationMessages}), []);

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

  useEffect(() => {
    if (data?.data && data.data.length > 0) {
      mapMessages(data.data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

  const updateMessage = (
    id: string,
    selection: TextSelection,
    commentId: string,
  ) => {
    const messageId = data.data.findIndex(message => message.id === id);
    if (messageId) {
      const message = data.data[messageId];
      const newMessagePart = splitByCommentRanges(message.content, [
        ...mapThreadRanges(message.threads),
        {id: commentId, start: selection.startIndex, end: selection.endIndex},
      ]);
      const currentConversationMessages = [...conversationMessages];
      const mappedMessageIndex = currentConversationMessages.findIndex(
        messageItem => messageItem.id === id,
      );
      if (mappedMessageIndex) {
        currentConversationMessages.splice(mappedMessageIndex, 1, {
          ...currentConversationMessages[mappedMessageIndex],
          messagePart: newMessagePart,
        });
      }
      setConversationMessages(currentConversationMessages);
    }
  };

  const handleSendComment = async () => {
    if (
      selectedMessageId &&
      comment.trim().length > 0 &&
      currentHighlightedText?.selectedText
    ) {
      try {
        const response = await addReviewComment({
          reviewId: _reviewId,
          messageId: selectedMessageId,
          comment,
        });
        if (response.data) {
          if (currentHighlightedText) {
            updateMessage(
              selectedMessageId,
              currentHighlightedText,
              response.data?.commentId,
            );
          } else {
            // TODO_M: Logic to append new comment in the thread/comment/reply
          }
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

  const mapThreadRanges = threads => {
    return threads.map(thread => {
      return {
        id: thread.id,
        start: thread.selection.startIndex,
        end: thread.selection.endIndex,
      };
    });
  };

  const mapMessages = (messageData: Message[]) => {
    const mappedMessages = messageData.map(message => {
      return {
        id: message.id,
        messages: message.content,
        startSeconds: message.startSeconds,
        endSeconds: message.endSeconds,
        senderId: message.senderId,
        messagePart: splitByCommentRanges(
          message.content,
          mapThreadRanges(message.threads),
        ),
      };
    });
    setConversationMessages(mappedMessages as unknown as MessageData[]);
  };

  const handleThreadClick = (threadId: string, messageId: string) => {
    if (!showCommentInput) {
      showThreadsBottomSheet();
    }
    console.log('threadId', threadId);
    const message = data?.data?.find(
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
        currentHighlightedText={currentHighlightedText}
        onThreadClick={handleThreadClick}
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

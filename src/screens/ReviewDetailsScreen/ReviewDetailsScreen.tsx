import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useRoute} from '@react-navigation/native';
import {ActivityIndicator, SafeAreaView, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  CommentInput,
  CommentThreadBottomSheet,
  Conversation,
  MessageThreadsBottomSheet,
  ReplyBottomSheet,
  ThreadsBottomSheet,
} from '@/components';
import {InteractionsBar} from '@/components/ReviewTranscriptHeader/InteractionsBar';
import {useAppNavigation, useHardwareBackPressHandler} from '@/hooks';
import {
  useAddReviewCommentMutation,
  useGetMessagesQuery,
} from '@/services/reviewsApi';
import {colors} from '@/theme';
import {
  Message,
  MessageData,
  MessageThread,
  TextSelection,
} from '@/types/reviews';
import {splitByCommentRanges} from '@/utils/reviews';

import {useReviewComments} from './hooks/useReviewComments';

const MESSAGES_PER_PAGE = 10;

export const ReviewDetailsScreen: React.FC = () => {
  const isSelectable = true;
  const route = useRoute<any>();
  const {reviewId: _reviewId} = route.params || {};
  const currentMessageIdRef = useRef<string | null>(null);

  // State management
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [rawMessages, setRawMessages] = useState<Message[]>([]);
  const [conversationMessages, setConversationMessages] = useState<
    MessageData[]
  >([]);
  const [comment, setComment] = useState('');
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [currentHighlightedText, setCurrentHighlightedText] =
    useState<TextSelection | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>();
  const [isMessageThreadsVisible, setIsMessageThreadsVisible] = useState(false);
  const [selectedMessageForThreads, setSelectedMessageForThreads] = useState<
    string | null
  >(null);
  const navigation = useAppNavigation();

  useHardwareBackPressHandler(() => {
    handleCloseMessageThreads();
    navigation.goBack();
    return true;
  });

  // API hooks
  const {
    data: messagesData,
    isLoading,
    isFetching,
    isError,
  } = useGetMessagesQuery(
    {reviewId: _reviewId, offset, limit: MESSAGES_PER_PAGE},
    {skip: !_reviewId},
  );

  const [addReviewComment, {isLoading: isAddingComment}] =
    useAddReviewCommentMutation();

  // Custom hooks
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

  // Helper to map message threads to comment ranges
  const mapMessageThreads = useCallback((threads: MessageThread[]) => {
    return threads.map(thread => ({
      id: thread.id,
      start: thread.selection.startIndex as number,
      end: thread.selection.endIndex as number,
    }));
  }, []);

  // Helper to map raw message to conversation format
  const mapMessageToConversation = useCallback(
    (message: Message): MessageData => {
      return {
        id: message.id,
        content: message.content,
        startSeconds: message.startSeconds,
        endSeconds: message.endSeconds,
        senderId: message.senderId,
        createdAt: message.createdAt,
        messagePart: splitByCommentRanges(
          message.content,
          mapMessageThreads(message.threads),
        ),
      };
    },
    [mapMessageThreads],
  );

  // Helper to merge messages avoiding duplicates
  const mergeMessages = useCallback(
    <T extends {id: string}>(existing: T[], newItems: T[]): T[] => {
      const existingIds = new Set(existing.map(m => m.id));
      const uniqueNewItems = newItems.filter(m => !existingIds.has(m.id));
      return [...existing, ...uniqueNewItems];
    },
    [],
  );

  // Update messages when new data is fetched
  useEffect(() => {
    if (!messagesData?.data) return;

    const newMessages = messagesData.data;
    const isInitialLoad = offset === 0;

    // Update raw messages
    setRawMessages(prev =>
      isInitialLoad ? newMessages : mergeMessages(prev, newMessages),
    );

    // Map and update conversation messages
    const mappedMessages = newMessages.map(mapMessageToConversation);
    setConversationMessages(prev =>
      isInitialLoad ? mappedMessages : mergeMessages(prev, mappedMessages),
    );

    // Update pagination state
    setHasMore(newMessages.length >= MESSAGES_PER_PAGE);
  }, [messagesData, offset, mapMessageToConversation, mergeMessages]);

  // Create a new thread object
  const createNewThread = useCallback(
    (commentId: string, selection: TextSelection): MessageThread => ({
      id: commentId,
      selection: {
        startIndex: selection.startIndex,
        endIndex: selection.endIndex,
        selectedText: selection.selectedText,
      },
      comments: [],
      createdBy: {
        id: '',
        name: '',
        profileImage: null,
      },
    }),
    [],
  );

  // Update message with new comment thread
  const updateMessage = useCallback(
    (payload: {
      selection: TextSelection;
      commentId: string;
      messageId: string;
    }) => {
      const {selection, commentId, messageId} = payload;

      // Update raw messages with new thread
      setRawMessages(prev => {
        const messageIndex = prev.findIndex(m => m.id === messageId);
        if (messageIndex === -1) return prev;

        const updatedMessages = [...prev];
        const newThread = createNewThread(commentId, selection);

        updatedMessages[messageIndex] = {
          ...updatedMessages[messageIndex],
          threads: [...updatedMessages[messageIndex].threads, newThread],
        };

        return updatedMessages;
      });

      // Update conversation messages with new message parts
      setConversationMessages(prev => {
        const messageIndex = prev.findIndex(m => m.id === messageId);
        if (messageIndex === -1) return prev;

        const updatedMessages = [...prev];
        const currentMessage = updatedMessages[messageIndex];
        const rawMessage = rawMessages.find(m => m.id === messageId);

        if (!rawMessage) return prev;

        // Recalculate message parts with all threads
        const allThreadRanges = [
          ...mapMessageThreads(rawMessage.threads),
          {id: commentId, start: selection.startIndex, end: selection.endIndex},
        ];

        updatedMessages[messageIndex] = {
          ...currentMessage,
          messagePart: splitByCommentRanges(
            currentMessage.content,
            allThreadRanges,
          ),
        };

        return updatedMessages;
      });
    },
    [rawMessages, createNewThread, mapMessageThreads],
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
    setRawMessages([]);
    setConversationMessages([]);
  }, []);

  // Comment input handlers - MUST be before early returns
  const handleChangeComment = useCallback((text: string) => {
    setComment(text);
  }, []);

  const resetCommentInput = useCallback(() => {
    setShowCommentInput(false);
    setComment('');
    setCurrentHighlightedText(null);
    setSelectedMessageId(null);
  }, []);

  const handleSelection = useCallback(
    (selection: TextSelection, messageId: string) => {
      setShowCommentInput(true);
      setCurrentHighlightedText(selection);
      setSelectedMessageId(messageId);
    },
    [],
  );

  const handleSendComment = useCallback(async () => {
    if (
      !selectedMessageId ||
      !comment.trim() ||
      !currentHighlightedText?.selectedText
    ) {
      return;
    }

    try {
      const payload = {
        reviewId: _reviewId,
        messageId: selectedMessageId,
        selection: currentHighlightedText,
        content: comment.trim(),
        ...(selectedComment?.id && {parentCommentId: selectedComment.id}),
        ...(selectedThreadId && {threadId: selectedThreadId}),
      };

      const response = await addReviewComment(payload);

      if (response.data?.comment?.id) {
        updateMessage({
          selection: currentHighlightedText,
          commentId: response.data.comment.id,
          messageId: selectedMessageId,
        });
      }
    } catch (error) {
      console.error('Failed to add comment:', error);
    } finally {
      resetCommentInput();
    }
  }, [
    selectedMessageId,
    comment,
    currentHighlightedText,
    _reviewId,
    selectedComment,
    selectedThreadId,
    addReviewComment,
    updateMessage,
    resetCommentInput,
  ]);

  const handleThreadClick = useCallback(
    (threadId: string, messageId: string) => {
      if (!showCommentInput) {
        setSelectedMessageForThreads(messageId);
        setIsMessageThreadsVisible(true);
      }
    },
    [showCommentInput],
  );

  const handleCloseMessageThreads = useCallback(() => {
    setIsMessageThreadsVisible(false);
    setSelectedMessageForThreads(null);
  }, []);

  const handleMessageThreadPress = useCallback(
    (threadId: string, messageId: string) => {
      // Close message threads bottom sheet and open comment thread bottom sheet
      currentMessageIdRef.current = messageId;
      setIsMessageThreadsVisible(false);
      onThreadPress(threadId);
    },
    [onThreadPress],
  );

  // TOOD_M: Logic to handle back button for message threads bottom sheet
  // const handleHideCommentThreadBottomSheet = () => {
  //   if (currentMessageIdRef.current) {
  //     setIsMessageThreadsVisible(true);
  //     setSelectedMessageForThreads(currentMessageIdRef.current);
  //   }
  //   hideCommentThreadBottomSheet();
  // };

  // Get threads for selected message
  const selectedMessageThreads = useMemo(() => {
    if (!selectedMessageForThreads) return [];
    const message = rawMessages.find(m => m.id === selectedMessageForThreads);
    return message?.threads || [];
  }, [selectedMessageForThreads, rawMessages]);

  // Early returns after ALL hooks
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
      <View style={styles.interactionsBarContainer}>
        <InteractionsBar
          reviewId={_reviewId}
          reactions={{}}
          commentsCount={0}
          onCommentPress={showThreadsBottomSheet}
        />
      </View>

      <ThreadsBottomSheet
        visible={isThreadsBottomSheetVisible}
        onClose={closeThreadsBottomSheet}
        reviewId={_reviewId}
        onThreadPress={onThreadPress}
      />
      <MessageThreadsBottomSheet
        visible={isMessageThreadsVisible}
        onClose={handleCloseMessageThreads}
        messageId={selectedMessageForThreads || ''}
        message={
          conversationMessages.find(m => m.id === selectedMessageForThreads)
            ?.content || ''
        }
        threads={selectedMessageThreads}
        onThreadPress={handleMessageThreadPress}
      />
      <CommentThreadBottomSheet
        visible={isCommentThreadBottomSheetVisible}
        onClose={closeCommentThreadBottomSheet}
        reviewId={_reviewId}
        threadId={selectedThreadId || ''}
        onAddReactionPress={_commentId => {
          // Handle add reaction press
        }}
        onReplyPress={onReplyPress}
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

const styles = ScaledSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.white,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  interactionsBarContainer: {
    position: 'absolute',
    bottom: '30@vs',
    left: 0,
    right: 0,
  },
});

export default ReviewDetailsScreen;

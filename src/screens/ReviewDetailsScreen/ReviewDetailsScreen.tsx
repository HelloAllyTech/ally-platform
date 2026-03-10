import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {LeftArrow} from '@/assets';
import {
  CommentInput,
  CommentThreadBottomSheet,
  Conversation,
  MessageThreadsBottomSheet,
  ReplyBottomSheet,
  ThreadsBottomSheet,
} from '@/components';
import {ThreadCommentChange} from '@/components/CommentThreadBottomSheet/types';
import {InteractionsBar} from '@/components/ReviewTranscriptHeader/InteractionsBar';
import {ReviewTranscriptHeader} from '@/components/ReviewTranscriptHeader/ReviewTranscriptHeader';
import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useHardwareBackPressHandler, useUser} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {
  useAddReviewCommentMutation,
  useGetReviewByIdQuery,
  useLazyGetMessagesQuery,
} from '@/services/reviewsApi';
import {colors} from '@/theme';
import {GetMessagesResponse} from '@/types';
import {
  Message,
  MessageData,
  MessageThread,
  TextSelection,
} from '@/types/reviews';
import {splitByCommentRanges} from '@/utils/reviews';

import {useReviewComments} from './hooks/useReviewComments';

const MESSAGES_PER_PAGE = 10;

type Props = RootStackScreenProps<'ReviewDetails'>;

export const ReviewDetailsScreen: React.FC<Props> = ({route}) => {
  const insets = useSafeAreaInsets();
  const {reviewId: _reviewId, isPrivate} = route.params || {};
  const currentMessageIdRef = useRef<string | null>(null);

  // const {isPrivate, setIsPrivate, handleTogglePrivate} = useShareReview({
  //   reviewId: _reviewId,
  // });

  // useEffect(() => {
  //   if (initialIsPrivate !== undefined) {
  //     setIsPrivate(initialIsPrivate);
  //   }
  // }, [initialIsPrivate, setIsPrivate]);

  // State management
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [rawMessages, setRawMessages] = useState<Message[]>([]);
  const previousOffsetRef = useRef<number>(0);
  const isInitialMountRef = useRef(true);
  const [comment, setComment] = useState('');
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [currentHighlightedText, setCurrentHighlightedText] =
    useState<TextSelection | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>();
  const [isMessageThreadsVisible, setIsMessageThreadsVisible] = useState(false);
  const [selectedMessageForThreads, setSelectedMessageForThreads] = useState<
    string | null
  >(null);
  const [currentMessageThreadIds, setCurrentMessageThreadIds] = useState<
    string[]
  >([]);
  const navigation = useAppNavigation();

  const {userData} = useUser();
  const {
    id: userId,
    name: userName,
    profileImageUrl: userProfileImage,
  } = userData || {};

  useHardwareBackPressHandler(() => {
    // Check if any bottom sheet is open and dismiss it first
    if (isReplyBottomSheetVisible) {
      closeReplyBottomSheet();
      return true;
    }
    if (isCommentThreadBottomSheetVisible) {
      closeCommentThreadBottomSheet();
      return true;
    }
    if (isMessageThreadsVisible) {
      handleCloseMessageThreads();
      return true;
    }
    if (isThreadsBottomSheetVisible) {
      closeThreadsBottomSheet();
      return true;
    }
    if (showCommentInput) {
      resetCommentInput();
      return true;
    }
    // Otherwise, navigate back
    navigation.goBack();
    return true;
  });

  const [fetchMessages, {isLoading, isFetching, isError}] =
    useLazyGetMessagesQuery();

  const {data: reviewData, refetch: refetchReviewData} = useGetReviewByIdQuery(
    {
      reviewId: _reviewId,
    },
    {
      refetchOnMountOrArgChange: true,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    },
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
    setSelectedThreadId,
    isReplyBottomSheetVisible,
    closeReplyBottomSheet,
    selectedComment,
    setSelectedComment,
    onReplyPress,
    onReplyPressFromGeneralComments,
    showThreadsBottomSheet,
    hideReplyBottomSheet,
    hideCommentThreadBottomSheet,
    closeCommentBottomSheet,
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

  // Process messages response and update state
  const processMessagesResponse = useCallback(
    (responseData: GetMessagesResponse | undefined, currentOffset: number) => {
      if (!responseData?.data) {
        return;
      }

      const newMessages = responseData.data;
      const isInitialLoad = currentOffset === 0;
      const isOffsetReset = previousOffsetRef.current > currentOffset;

      // Update raw messages - reset on initial load or when offset decreases (refresh)
      setRawMessages(prev => {
        if (isInitialLoad || isOffsetReset) {
          return newMessages;
        }
        return mergeMessages(prev, newMessages);
      });

      // Update pagination state
      setHasMore(newMessages.length >= MESSAGES_PER_PAGE);

      // Track previous offset
      previousOffsetRef.current = currentOffset;
    },
    [mergeMessages],
  );

  // Fetch messages when offset changes or on initial mount
  useEffect(() => {
    if (!_reviewId) return;

    const fetchData = async () => {
      try {
        const result = await fetchMessages({
          reviewId: _reviewId,
          offset,
          limit: MESSAGES_PER_PAGE,
        });
        // Process the response directly
        if (result.data) {
          processMessagesResponse(result.data, offset);
        }
      } catch (error) {
        console.error('Error fetching messages:', error);
      }
    };

    // Fetch on initial mount
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      fetchData();
      return;
    }

    // Fetch when offset changes
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  // Derive conversation messages from raw messages using useMemo
  // This ensures conversationMessages is always in sync with rawMessages
  const conversationMessages = useMemo(() => {
    return rawMessages.map(mapMessageToConversation);
  }, [rawMessages, mapMessageToConversation]);

  // Create a new thread object
  const createNewThread = useCallback(
    (
      newComment: {id: string; createdAt: string; content: string},
      newThread: {id: string; createdAt: string},
      selection: TextSelection,
    ): MessageThread => ({
      id: newThread.id,
      selection: {
        startIndex: selection.startIndex,
        endIndex: selection.endIndex,
        selectedText: selection.selectedText,
      },
      comments: [
        {
          id: newComment.id,
          content: newComment.content,
          createdAt: newComment.createdAt,
          createdBy: {
            id: userId,
            name: userName,
            profileImage: userProfileImage,
          },
        },
      ],
      createdBy: {
        id: userId || 0,
        name: userName || '',
        profileImage: userProfileImage || null,
      },
    }),
    [userId, userName, userProfileImage],
  );

  // Update message with new comment thread
  const updateMessage = useCallback(
    (payload: {
      selection: TextSelection;
      newComment: {id: string; createdAt: string; content: string};
      newThread: {id: string; createdAt: string};
      messageId: string;
    }) => {
      const {selection, newComment, newThread, messageId} = payload;

      // Update raw messages with new thread
      setRawMessages(prev => {
        const messageIndex = prev.findIndex(
          m => m.id?.toString() === messageId.toString(),
        );
        if (messageIndex === -1) return prev;

        const updatedMessages = [...prev];
        const updatedThread = createNewThread(newComment, newThread, selection);

        updatedMessages[messageIndex] = {
          ...updatedMessages[messageIndex],
          threads: [...updatedMessages[messageIndex].threads, updatedThread],
        };

        return updatedMessages;
      });
    },
    [createNewThread],
  );

  // Pagination callbacks
  const loadMoreMessages = useCallback(() => {
    if (!isFetching && hasMore) {
      setOffset(prev => prev + MESSAGES_PER_PAGE);
    }
  }, [isFetching, hasMore]);

  const refreshMessages = useCallback(async () => {
    if (!_reviewId) return;
    setOffset(0);
    setHasMore(true);
    setRawMessages([]);
    previousOffsetRef.current = 0;

    try {
      refetchReviewData();
      const result = await fetchMessages({
        reviewId: _reviewId,
        offset: 0,
        limit: MESSAGES_PER_PAGE,
      });
      if (result.data) {
        processMessagesResponse(result.data, 0);
      }
    } catch (error) {
      console.error('Error refreshing messages:', error);
    }
  }, [_reviewId, fetchMessages, processMessagesResponse, refetchReviewData]);

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

  const handleThreadCommentChange = useCallback(
    (change: ThreadCommentChange) => {
      if (!selectedThreadId) return;

      setRawMessages(prev =>
        prev.map(message => {
          if (!message.threads.some(thread => thread.id === selectedThreadId)) {
            return message;
          }

          let updatedThreads;

          switch (change.action) {
            case 'delete':
              updatedThreads = message.threads
                .map(thread => {
                  if (thread.id !== selectedThreadId) {
                    return thread;
                  }
                  return {
                    ...thread,
                    comments: thread.comments.filter(
                      commentItem => commentItem.id !== change.commentId,
                    ),
                  };
                })
                .filter(thread => thread.comments.length > 0);
              if (
                !updatedThreads.some(thread => thread.id === selectedThreadId)
              ) {
                setSelectedComment(null);
                setSelectedThreadId(null);
              }
              break;

            case 'edit':
              updatedThreads = message.threads.map(thread => {
                if (thread.id !== selectedThreadId) {
                  return thread;
                }
                return {
                  ...thread,
                  comments: thread.comments.map(commentItem =>
                    commentItem.id === change.commentId
                      ? {...commentItem, content: change.content}
                      : commentItem,
                  ),
                };
              });
              break;

            case 'add':
              updatedThreads = message.threads.map(thread => {
                if (thread.id !== selectedThreadId) {
                  return thread;
                }
                return {
                  ...thread,
                  comments: [...thread.comments, change.comment],
                };
              });
              break;

            case 'hide':
              updatedThreads = message.threads.map(thread => {
                if (thread.id !== selectedThreadId) {
                  return thread;
                }
                return {
                  ...thread,
                  comments: thread.comments.map(commentItem =>
                    commentItem.id === change.commentId
                      ? {...commentItem, hidden: change.hidden}
                      : commentItem,
                  ),
                };
              });
              break;
          }

          return {...message, threads: updatedThreads};
        }),
      );
    },
    [selectedThreadId, setSelectedThreadId, setSelectedComment],
  );

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
      };

      const response = await addReviewComment(payload);

      if (response.data?.thread?.id && response.data?.comment) {
        updateMessage({
          selection: currentHighlightedText,
          newComment: {...response.data.comment, content: comment.trim()},
          newThread: response.data.thread,
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
    addReviewComment,
    updateMessage,
    resetCommentInput,
  ]);

  const handleThreadClick = useCallback(
    (threadIds: string[], messageId: string) => {
      if (!showCommentInput) {
        setSelectedMessageForThreads(messageId);
        setIsMessageThreadsVisible(true);
        setCurrentMessageThreadIds(threadIds);
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

  const handleHideCommentThreadBottomSheet = () => {
    if (currentMessageIdRef.current) {
      setIsMessageThreadsVisible(true);
      setSelectedMessageForThreads(currentMessageIdRef.current);
      closeCommentBottomSheet();
    } else {
      hideCommentThreadBottomSheet();
    }
  };

  const handleEditNote = useCallback(() => {
    navigation.navigate(SCREEN_NAMES.SHARE_SIMULATION, {
      reviewId: _reviewId,
      scenarioData: {
        coverImageUrl: reviewData?.scenario?.coverImageUrl,
        coverVideoUrl: reviewData?.scenario?.coverVideoUrl,
        title: reviewData?.scenario?.title || '',
        description: reviewData?.scenario?.description || '',
        createdAt: reviewData?.scenarioSession?.createdAt || '',
        duration: reviewData?.scenarioSession?.duration || '',
      },
    });
  }, [_reviewId, navigation, reviewData]);

  // Get threads for selected message
  const selectedMessageThreads = useMemo(() => {
    if (!selectedMessageForThreads || currentMessageThreadIds.length === 0)
      return [];
    const message = rawMessages.find(
      m => m.id?.toString() === selectedMessageForThreads.toString(),
    );
    return (
      message?.threads.filter(thread =>
        currentMessageThreadIds.includes(thread.id),
      ) || []
    );
  }, [selectedMessageForThreads, rawMessages, currentMessageThreadIds]);

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
    <SafeAreaView style={[styles.safe, {paddingTop: insets.top}]}>
      {/* Main conversation/messages view */}
      <View style={styles.titleContainer}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <LeftArrow color={colors.black} width={ms(16)} height={ms(16)} />
        </TouchableOpacity>
        {reviewData && (
          <ReviewTranscriptHeader
            user={reviewData?.createdBy}
            scenario={reviewData?.scenario}
            scenarioSession={reviewData?.scenarioSession}
          />
        )}
      </View>
      <Conversation
        messages={conversationMessages}
        isSelectable={!isPrivate}
        onSelection={handleSelection}
        onThreadClick={handleThreadClick}
        onLoadMore={loadMoreMessages}
        isLoadingMore={isFetching && offset > 0}
        hasMore={hasMore}
        onRefresh={refreshMessages}
        isRefreshing={isFetching && offset === 0}
        reviewOwnerName={reviewData?.createdBy?.name}
        onDismissSelection={resetCommentInput}
      />
      {/* Comment input bottom sheet */}

      <View style={styles.interactionsBarContainer}>
        <InteractionsBar
          reviewId={_reviewId}
          reactions={reviewData?.reactions || {}}
          commentsCount={reviewData?.commentsCount || 0}
          onCommentPress={showThreadsBottomSheet}
          refreshReactions={() => {
            refetchReviewData();
          }}
          myReaction={reviewData?.myReaction || null}
          isPrivate={isPrivate}
          // onTogglePrivate={handleTogglePrivate}
        />
      </View>
      <CommentInput
        visible={showCommentInput}
        onClose={resetCommentInput}
        onChangeText={handleChangeComment}
        onSend={handleSendComment}
        comment={comment}
        isSendButtonDisabled={comment.length === 0 || !comment.trim()}
        isLoading={isAddingComment}
      />
      <ThreadsBottomSheet
        isPrivate={isPrivate}
        visible={isThreadsBottomSheetVisible}
        onClose={closeThreadsBottomSheet}
        reviewId={_reviewId}
        reviewOwnerId={reviewData?.createdBy?.id}
        onThreadPress={onThreadPress}
        onReplyPress={onReplyPressFromGeneralComments}
        generalCommentsThreadId={reviewData?.generalCommentsThreadId || ''}
      />
      <MessageThreadsBottomSheet
        visible={isMessageThreadsVisible}
        onClose={handleCloseMessageThreads}
        messageId={selectedMessageForThreads || ''}
        message={
          conversationMessages.find(
            m => m.id?.toString() === selectedMessageForThreads?.toString(),
          )?.content || ''
        }
        threads={selectedMessageThreads}
        onThreadPress={handleMessageThreadPress}
      />
      <CommentThreadBottomSheet
        visible={isCommentThreadBottomSheetVisible}
        onClose={closeCommentThreadBottomSheet}
        reviewId={_reviewId}
        threadId={selectedThreadId || ''}
        reviewOwnerId={reviewData?.createdBy?.id}
        onReplyPress={onReplyPress}
        hideCommentThreadBottomSheet={handleHideCommentThreadBottomSheet}
        isPrivate={isPrivate}
        onCommentsChanged={handleThreadCommentChange}
      />
      <ReplyBottomSheet
        visible={isReplyBottomSheetVisible}
        onClose={closeReplyBottomSheet}
        commentId={selectedComment?.id || ''}
        originalComment={selectedComment || null}
        setOriginalComment={setSelectedComment}
        hideReplyBottomSheet={hideReplyBottomSheet}
        reviewId={_reviewId}
        reviewOwnerId={reviewData?.createdBy?.id}
        isPrivate={isPrivate}
        onCommentsChanged={handleThreadCommentChange}
      />
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.white,
  },
  titleContainer: {
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray7,
    // marginTop: '16@s',
    paddingVertical: '8@s',
    paddingHorizontal: '20@ms',
    flexDirection: 'row',
    alignItems: 'center',
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

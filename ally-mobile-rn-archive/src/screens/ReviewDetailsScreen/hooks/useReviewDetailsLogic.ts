import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {ThreadCommentChange} from '@/components/CommentThreadBottomSheet/types';
import {ReviewApiHooks, useReviewApiHooks} from '@/contexts/ReviewApiContext';
import {
  useAppNavigation,
  useHardwareBackPressHandler,
  useToggleReviewPrivacy,
  useUser,
} from '@/hooks';
import {GetMessagesResponse} from '@/types';
import {
  Message,
  MessageData,
  MessageThread,
  MessageThreadComment,
  TextSelection,
} from '@/types/reviews';
import {splitByCommentRanges} from '@/utils/reviews';

import {ReviewApiAdapter} from '../types';
import {useReviewComments} from './useReviewComments';

const MESSAGES_PER_PAGE = 10;

interface UseReviewDetailsLogicParams {
  reviewId: string;
  isPrivate?: boolean;
  api: ReviewApiAdapter;
  useUpdateReviewStatus?: ReviewApiHooks['useUpdateReviewStatus'];
}

export function useReviewDetailsLogic({
  reviewId,
  isPrivate,
  api,
  useUpdateReviewStatus: useUpdateReviewStatusOverride,
}: UseReviewDetailsLogicParams) {
  const {fetchMessages, messagesState, addComment, isAddingComment} = api;
  const {isLoading, isFetching, isError} = messagesState;

  const contextHooks = useReviewApiHooks();
  const updateMutation =
    useUpdateReviewStatusOverride ?? contextHooks.useUpdateReviewStatus;
  const {handleTogglePrivate} = useToggleReviewPrivacy(
    reviewId,
    updateMutation,
  );

  const navigation = useAppNavigation();
  const currentMessageIdRef = useRef<string | null>(null);

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

  const {userData} = useUser();
  const {
    id: userId,
    name: userName,
    profileImageUrl: userProfileImage,
  } = userData || {};

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
    onReplyPressFromInlineGeneral,
    showThreadsBottomSheet,
    hideReplyBottomSheet,
    hideCommentThreadBottomSheet,
    closeCommentBottomSheet,
  } = useReviewComments();

  useHardwareBackPressHandler(() => {
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
    navigation.goBack();
    return true;
  });

  const mapMessageThreads = useCallback((threads: MessageThread[]) => {
    return threads.map(thread => ({
      id: thread.id,
      start: thread.selection.startIndex as number,
      end: thread.selection.endIndex as number,
    }));
  }, []);

  const mapMessageToConversation = useCallback(
    (message: Message): MessageData => ({
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
    }),
    [mapMessageThreads],
  );

  const mergeMessages = useCallback(
    <T extends {id: string}>(existing: T[], newItems: T[]): T[] => {
      const existingIds = new Set(existing.map(m => m.id));
      const uniqueNewItems = newItems.filter(m => !existingIds.has(m.id));
      return [...existing, ...uniqueNewItems];
    },
    [],
  );

  const processMessagesResponse = useCallback(
    (responseData: GetMessagesResponse | undefined, currentOffset: number) => {
      if (!responseData?.data) {
        return;
      }

      const newMessages = responseData.data;
      const isInitialLoad = currentOffset === 0;
      const isOffsetReset = previousOffsetRef.current > currentOffset;

      setRawMessages(prev => {
        if (isInitialLoad || isOffsetReset) {
          return newMessages;
        }
        return mergeMessages(prev, newMessages);
      });

      setHasMore(newMessages.length >= MESSAGES_PER_PAGE);
      previousOffsetRef.current = currentOffset;
    },
    [mergeMessages],
  );

  useEffect(() => {
    if (!reviewId) return;

    const fetchData = async () => {
      try {
        const result = await fetchMessages({
          reviewId,
          offset,
          limit: MESSAGES_PER_PAGE,
        });
        if (result.data) {
          processMessagesResponse(result.data, offset);
        }
      } catch (error) {
        console.error('Error fetching messages:', error);
      }
    };

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      fetchData();
      return;
    }

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const conversationMessages = useMemo(() => {
    return rawMessages.map(mapMessageToConversation);
  }, [rawMessages, mapMessageToConversation]);

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

  const updateMessage = useCallback(
    (payload: {
      selection: TextSelection;
      newComment: {id: string; createdAt: string; content: string};
      newThread: {id: string; createdAt: string};
      messageId: string;
    }) => {
      const {selection, newComment, newThread, messageId} = payload;

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

  const loadMoreMessages = useCallback(() => {
    if (!isFetching && hasMore) {
      setOffset(prev => prev + MESSAGES_PER_PAGE);
    }
  }, [isFetching, hasMore]);

  const refreshMessages = useCallback(async () => {
    if (!reviewId) return;
    setOffset(0);
    setHasMore(true);
    setRawMessages([]);
    previousOffsetRef.current = 0;

    try {
      api.refetchReviewData();
      const result = await fetchMessages({
        reviewId,
        offset: 0,
        limit: MESSAGES_PER_PAGE,
      });
      if (result.data) {
        processMessagesResponse(result.data, 0);
      }
    } catch (error) {
      console.error('Error refreshing messages:', error);
    }
  }, [reviewId, fetchMessages, processMessagesResponse, api]);

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
                      (commentItem: MessageThreadComment) =>
                        commentItem.id !== change.commentId,
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
                  comments: thread.comments.map(
                    (commentItem: MessageThreadComment) =>
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
                  comments: [change.comment, ...thread.comments],
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
                  comments: thread.comments.map(
                    (commentItem: MessageThreadComment) =>
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
        reviewId,
        messageId: selectedMessageId,
        selection: currentHighlightedText,
        content: comment.trim(),
      };

      const response = await addComment(payload);

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
    reviewId,
    addComment,
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
      currentMessageIdRef.current = messageId;
      setIsMessageThreadsVisible(false);
      onThreadPress(threadId);
    },
    [onThreadPress],
  );

  const handleHideCommentThreadBottomSheet = useCallback(() => {
    if (currentMessageIdRef.current) {
      setIsMessageThreadsVisible(true);
      setSelectedMessageForThreads(currentMessageIdRef.current);
      closeCommentBottomSheet();
    } else {
      hideCommentThreadBottomSheet();
    }
  }, [closeCommentBottomSheet, hideCommentThreadBottomSheet]);

  const selectedMessageThreads = useMemo(() => {
    if (!selectedMessageForThreads || currentMessageThreadIds.length === 0) {
      return [];
    }
    const message = rawMessages.find(
      m => m.id?.toString() === selectedMessageForThreads.toString(),
    );
    return (
      message?.threads.filter(thread =>
        currentMessageThreadIds.includes(thread.id),
      ) || []
    );
  }, [selectedMessageForThreads, rawMessages, currentMessageThreadIds]);

  const selectedMessageContent = useMemo(() => {
    if (!selectedMessageForThreads) return '';
    return (
      conversationMessages.find(
        m => m.id?.toString() === selectedMessageForThreads.toString(),
      )?.content || ''
    );
  }, [selectedMessageForThreads, conversationMessages]);

  return {
    conversationMessages,
    isLoading,
    isFetching,
    isError,
    offset,
    hasMore,
    isPrivate,
    handleTogglePrivate,

    comment,
    showCommentInput,
    isAddingComment,
    handleChangeComment,
    resetCommentInput,
    handleSendComment,
    handleSelection,

    loadMoreMessages,
    refreshMessages,

    isThreadsBottomSheetVisible,
    closeThreadsBottomSheet,
    showThreadsBottomSheet,
    onThreadPress,

    isCommentThreadBottomSheetVisible,
    closeCommentThreadBottomSheet,
    selectedThreadId,
    handleHideCommentThreadBottomSheet,
    onReplyPress,
    onReplyPressFromGeneralComments,
    onReplyPressFromInlineGeneral,
    handleThreadCommentChange,

    isReplyBottomSheetVisible,
    closeReplyBottomSheet,
    selectedComment,
    setSelectedComment,
    hideReplyBottomSheet,

    isMessageThreadsVisible,
    handleCloseMessageThreads,
    selectedMessageForThreads,
    selectedMessageContent,
    selectedMessageThreads,
    handleMessageThreadPress,

    handleThreadClick,
  };
}

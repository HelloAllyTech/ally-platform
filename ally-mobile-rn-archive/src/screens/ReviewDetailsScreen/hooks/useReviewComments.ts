import {useCallback, useRef, useState} from 'react';

import {MessageThreadComment, ReplySource} from '@/types/reviews';

export const useReviewComments = () => {
  const [isThreadsBottomSheetVisible, setIsThreadsBottomSheetVisible] =
    useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [
    isCommentThreadBottomSheetVisible,
    setIsCommentThreadBottomSheetVisible,
  ] = useState(false);
  const [isReplyBottomSheetVisible, setIsReplyBottomSheetVisible] =
    useState(false);
  const [selectedComment, setSelectedComment] =
    useState<MessageThreadComment | null>(null);
  const replySourceRef = useRef<ReplySource>(ReplySource.THREAD);

  const showThreadsBottomSheet = () => {
    setIsThreadsBottomSheetVisible(true);
  };

  const closeThreadsBottomSheet = () => {
    setIsThreadsBottomSheetVisible(false);
  };

  const closeCommentThreadBottomSheet = () => {
    setIsCommentThreadBottomSheetVisible(false);
  };

  const onThreadPress = (threadId: string) => {
    setSelectedThreadId(threadId);
    setIsThreadsBottomSheetVisible(false);
    setIsCommentThreadBottomSheetVisible(true);
  };

  const closeReplyBottomSheet = () => {
    setIsReplyBottomSheetVisible(false);
    setSelectedComment(null);
  };

  const onReplyPress = (comment: MessageThreadComment) => {
    setSelectedComment(comment);
    replySourceRef.current = ReplySource.THREAD;
    setIsCommentThreadBottomSheetVisible(false);
    setIsReplyBottomSheetVisible(true);
  };

  const onReplyPressFromGeneralComments = (comment: MessageThreadComment) => {
    setSelectedComment(comment);
    replySourceRef.current = ReplySource.GENERAL;
    setIsThreadsBottomSheetVisible(false);
    setIsReplyBottomSheetVisible(true);
  };

  const onReplyPressFromInlineGeneral = useCallback(
    (comment: MessageThreadComment) => {
      setSelectedComment(comment);
      replySourceRef.current = ReplySource.INLINE_GENERAL;
      setIsReplyBottomSheetVisible(true);
    },
    [],
  );

  const hideReplyBottomSheet = () => {
    setIsReplyBottomSheetVisible(false);
    setSelectedComment(null);
    if (replySourceRef.current === ReplySource.GENERAL) {
      setIsThreadsBottomSheetVisible(true);
    } else if (replySourceRef.current === ReplySource.INLINE_GENERAL) {
      // No bottom sheet to reopen — inline section is always visible
    } else {
      setIsCommentThreadBottomSheetVisible(true);
    }
  };

  const hideCommentThreadBottomSheet = () => {
    setIsCommentThreadBottomSheetVisible(false);
    setIsThreadsBottomSheetVisible(true);
    setSelectedThreadId(null);
  };

  const closeCommentBottomSheet = () => {
    setIsCommentThreadBottomSheetVisible(false);
  };

  return {
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
    replySourceRef,
    hideCommentThreadBottomSheet,
    closeCommentBottomSheet,
  };
};

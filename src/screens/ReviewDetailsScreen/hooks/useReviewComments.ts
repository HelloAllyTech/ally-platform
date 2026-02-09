import {useState} from 'react';

import {MessageThreadComment} from '@/types/reviews';

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
    setIsCommentThreadBottomSheetVisible(false);
    setIsReplyBottomSheetVisible(true);
  };

  const hideReplyBottomSheet = () => {
    setIsReplyBottomSheetVisible(false);
    setIsCommentThreadBottomSheetVisible(true);
    setSelectedComment(null);
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
    isReplyBottomSheetVisible,
    closeReplyBottomSheet,
    selectedComment,
    setSelectedComment,
    onReplyPress,
    showThreadsBottomSheet,
    hideReplyBottomSheet,
    hideCommentThreadBottomSheet,
    closeCommentBottomSheet,
  };
};

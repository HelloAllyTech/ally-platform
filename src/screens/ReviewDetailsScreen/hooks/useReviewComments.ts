import {useState} from 'react';

import {MessageThreadComment} from '@/types/reviews';

export const useReviewComments = () => {
  const [isCommentsBottomSheetVisible, setIsCommentsBottomSheetVisible] =
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

  const showCommentsBottomSheet = () => {
    setIsCommentsBottomSheetVisible(true);
  };

  const closeCommentsBottomSheet = () => {
    setIsCommentsBottomSheetVisible(false);
  };

  const closeCommentThreadBottomSheet = () => {
    setIsCommentThreadBottomSheetVisible(false);
    setIsCommentsBottomSheetVisible(true);
  };

  const onThreadPress = (threadId: string) => {
    setSelectedThreadId(threadId);
    setIsCommentsBottomSheetVisible(false);
    setIsCommentThreadBottomSheetVisible(true);
  };

  const closeReplyBottomSheet = () => {
    setIsReplyBottomSheetVisible(false);
    setIsCommentThreadBottomSheetVisible(true);
  };

  const onReplyPress = (comment: MessageThreadComment) => {
    setSelectedComment(comment);
    setIsCommentThreadBottomSheetVisible(false);
    setIsReplyBottomSheetVisible(true);
  };

  return {
    isCommentsBottomSheetVisible,
    closeCommentsBottomSheet,
    onThreadPress,
    isCommentThreadBottomSheetVisible,
    closeCommentThreadBottomSheet,
    selectedThreadId,
    isReplyBottomSheetVisible,
    closeReplyBottomSheet,
    selectedComment,
    setSelectedComment,
    onReplyPress,
    showCommentsBottomSheet,
  };
};

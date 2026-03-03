import React from 'react';
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
import {InteractionsBar} from '@/components/ReviewTranscriptHeader/InteractionsBar';
import {useAppNavigation} from '@/hooks';
import {colors} from '@/theme';

import {useReviewDetailsLogic} from '../hooks/useReviewDetailsLogic';
import {ReviewMetadata} from '../types';

interface ReviewDetailsLayoutProps {
  reviewId: string;
  isPrivate?: boolean;
  reviewLogic: ReturnType<typeof useReviewDetailsLogic>;
  metadata: ReviewMetadata | undefined;
  onRefreshReactions: () => void;
  renderHeader: () => React.ReactNode;
}

export const ReviewDetailsLayout: React.FC<ReviewDetailsLayoutProps> = ({
  reviewId,
  isPrivate,
  reviewLogic,
  metadata,
  onRefreshReactions,
  renderHeader,
}) => {
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();

  const {
    conversationMessages,
    isLoading,
    isError,
    isFetching,
    offset,
    hasMore,
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
  } = reviewLogic;

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
      <View style={styles.titleContainer}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <LeftArrow color={colors.black} width={ms(16)} height={ms(16)} />
        </TouchableOpacity>
        {renderHeader()}
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
        reviewOwnerName={metadata?.createdBy?.name}
        onDismissSelection={resetCommentInput}
      />

      <View style={styles.interactionsBarContainer}>
        <InteractionsBar
          reviewId={reviewId}
          reactions={metadata?.reactions || {}}
          commentsCount={metadata?.commentsCount || 0}
          onCommentPress={showThreadsBottomSheet}
          refreshReactions={onRefreshReactions}
          myReaction={metadata?.myReaction || null}
          isPrivate={isPrivate}
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
        visible={isThreadsBottomSheetVisible}
        onClose={closeThreadsBottomSheet}
        reviewId={reviewId}
        reviewOwnerId={metadata?.reviewOwnerId}
        onThreadPress={onThreadPress}
        onCommentsChanged={handleThreadCommentChange}
      />
      <MessageThreadsBottomSheet
        visible={isMessageThreadsVisible}
        onClose={handleCloseMessageThreads}
        messageId={selectedMessageForThreads || ''}
        message={selectedMessageContent}
        threads={selectedMessageThreads}
        onThreadPress={handleMessageThreadPress}
      />
      <CommentThreadBottomSheet
        visible={isCommentThreadBottomSheetVisible}
        onClose={closeCommentThreadBottomSheet}
        reviewId={reviewId}
        threadId={selectedThreadId || ''}
        reviewOwnerId={metadata?.reviewOwnerId}
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
        reviewId={reviewId}
        reviewOwnerId={metadata?.reviewOwnerId}
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

import React, {useCallback, useMemo, useRef, useState} from 'react';
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
  ConfirmationModal,
  Conversation,
  MessageThreadsBottomSheet,
  ReplyBottomSheet,
  ThreadsBottomSheet,
} from '@/components';
import {ThreadCommentChange} from '@/components/CommentThreadBottomSheet/types';
import {InteractionsBar} from '@/components/ReviewTranscriptHeader/InteractionsBar';
import {useAppNavigation, useTranslate, useUser} from '@/hooks';
import {colors} from '@/theme';
import {ReplySource} from '@/types/reviews';

import {useReviewDetailsLogic} from '../hooks/useReviewDetailsLogic';
import {ReviewMetadata} from '../types';
import {
  DeleteConfirmationState,
  GeneralCommentsSection,
  GeneralCommentsSectionRef,
} from './GeneralCommentsSection';
import {ReviewNote} from './ReviewNote';

interface ReviewDetailsLayoutProps {
  reviewId: string;
  reviewNote?: string;
  reviewLogic: ReturnType<typeof useReviewDetailsLogic>;
  metadata: ReviewMetadata | undefined;
  onRefreshReactions: () => void;
  onEditNote?: () => void;
  renderHeader: () => React.ReactNode;
}

export const ReviewDetailsLayout: React.FC<ReviewDetailsLayoutProps> = ({
  reviewId,
  reviewNote,
  reviewLogic,
  metadata,
  onRefreshReactions,
  onEditNote,
  renderHeader,
}) => {
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const {t} = useTranslate();

  const [generalDeleteState, setGeneralDeleteState] =
    useState<DeleteConfirmationState | null>(null);

  const handleDeleteConfirmationChange = useCallback(
    (state: DeleteConfirmationState | null) => {
      setGeneralDeleteState(state);
    },
    [],
  );

  const generalCommentsSectionRef = useRef<GeneralCommentsSectionRef>(null);

  const {userData} = useUser();

  const {
    conversationMessages,
    isLoading,
    isError,
    isFetching,
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
    replySourceRef,
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

  const handleReplyAdded = useCallback(
    (parentCommentId: string) => {
      if (
        replySourceRef.current === ReplySource.INLINE_GENERAL ||
        replySourceRef.current === ReplySource.GENERAL
      ) {
        generalCommentsSectionRef.current?.incrementReplyCount(parentCommentId);
      }
    },
    [replySourceRef],
  );

  const handleGeneralCommentChange = useCallback(
    (change: ThreadCommentChange) => {
      generalCommentsSectionRef.current?.syncCommentChange(change);
    },
    [],
  );

  const generalCommentsFooter = useMemo(
    () => (
      <GeneralCommentsSection
        ref={generalCommentsSectionRef}
        isPrivate={isPrivate}
        reviewId={reviewId}
        generalCommentsThreadId={metadata?.generalCommentsThreadId}
        reviewOwnerId={metadata?.reviewOwnerId}
        onCommentsChanged={onRefreshReactions}
        onDeleteConfirmationChange={handleDeleteConfirmationChange}
        onReplyPress={onReplyPressFromInlineGeneral}
      />
    ),
    [
      isPrivate,
      reviewId,
      metadata?.generalCommentsThreadId,
      metadata?.reviewOwnerId,
      onRefreshReactions,
      handleDeleteConfirmationChange,
      onReplyPressFromInlineGeneral,
    ],
  );

  const noteElementHeader = useMemo(() => {
    if (reviewNote) {
      return (
        <ReviewNote
          note={reviewNote}
          onEditNote={
            metadata?.reviewOwnerId === userData?.id ? onEditNote : undefined
          }
        />
      );
    }
    return null;
  }, [reviewNote, metadata?.reviewOwnerId, userData?.id, onEditNote]);

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
        listFooterComponent={generalCommentsFooter}
        listHeaderComponent={noteElementHeader}
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
          onTogglePrivate={
            metadata?.reviewOwnerId === userData?.id
              ? handleTogglePrivate
              : undefined
          }
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
        onReplyPress={onReplyPressFromGeneralComments}
        onCommentsChanged={handleGeneralCommentChange}
        generalCommentsThreadId={metadata?.generalCommentsThreadId || ''}
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
        onReplyAdded={handleReplyAdded}
      />
      <ConfirmationModal
        visible={!!generalDeleteState}
        onClose={generalDeleteState?.onClose ?? (() => {})}
        onConfirm={generalDeleteState?.onConfirm ?? (() => {})}
        title={t('ThreadsBottomSheet.deleteConfirmation.title')}
        description={t('ThreadsBottomSheet.deleteConfirmation.description')}
        confirmLabel={t('ThreadsBottomSheet.deleteConfirmation.confirm')}
        cancelLabel={t('ThreadsBottomSheet.deleteConfirmation.cancel')}
        confirmVariant="destructive"
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

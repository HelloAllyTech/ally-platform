import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  Text,
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
  InteractionsBar,
  MessageThreadsBottomSheet,
  ReplyBottomSheet,
  ThreadsBottomSheet,
} from '@/components';
import {useAppNavigation, useTranslate, useUser} from '@/hooks';
import {SimulationAudioPlayer} from '@/screens/SimulationFeedbackScreen/components/SimulationAudioPlayer/SimulationAudioPlayer';
import {colors, fontFamily} from '@/theme';

import {useReviewDetailsLogic} from '../hooks/useReviewDetailsLogic';
import {ReviewMetadata} from '../types';
import {
  DeleteConfirmationState,
  GeneralCommentsSection,
} from './GeneralCommentsSection';
import {ReviewNote} from './ReviewNote';

interface ReviewDetailsLayoutProps {
  isScribeReview?: boolean;
  reviewId: string;
  reviewNote?: string;
  audioUrl?: string | null;
  reviewLogic: ReturnType<typeof useReviewDetailsLogic>;
  metadata: ReviewMetadata | undefined;
  onRefreshReactions: () => void;
  onEditNote?: () => void;
  renderHeader: () => React.ReactNode;
  canEditReview?: boolean;
  canViewThreads?: boolean;
  canEditThread?: boolean;
  toggleInHeader?: boolean;
}

export const ReviewDetailsLayout: React.FC<ReviewDetailsLayoutProps> = ({
  isScribeReview = false,
  reviewId,
  reviewNote,
  audioUrl,
  reviewLogic,
  metadata,
  onRefreshReactions,
  onEditNote,
  renderHeader,
  canEditReview = true,
  canViewThreads = true,
  canEditThread = true,
  toggleInHeader = false,
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

  const generalCommentsFooter = useMemo(
    () => (
      <GeneralCommentsSection
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
    const hasNote = !!reviewNote || !!onEditNote;
    if (!audioUrl && !hasNote) {
      return null;
    }
    return (
      <>
        {!!audioUrl && (
          <SimulationAudioPlayer
            audioUrl={audioUrl}
            onProgress={() => {}}
            containerStyle={styles.audioPlayer}
          />
        )}
        {hasNote && <ReviewNote note={reviewNote} onEditNote={onEditNote} />}
      </>
    );
  }, [audioUrl, reviewNote, onEditNote]);

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
      {!isScribeReview && (
        <Text style={styles.transcriptDisclaimer}>
          {t('transcription.accuracyDisclaimer')}
        </Text>
      )}
      <Conversation
        isScribeReview={isScribeReview}
        messages={conversationMessages}
        isSelectable={!isPrivate && canEditThread}
        onSelection={handleSelection}
        onThreadClick={canViewThreads ? handleThreadClick : undefined}
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
          onCommentPress={canViewThreads ? showThreadsBottomSheet : undefined}
          refreshReactions={onRefreshReactions}
          myReaction={metadata?.myReaction || null}
          isPrivate={isPrivate}
          onTogglePrivate={
            !toggleInHeader &&
            canEditReview &&
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
        isPrivate={isPrivate}
        visible={isThreadsBottomSheetVisible}
        onClose={closeThreadsBottomSheet}
        reviewId={reviewId}
        reviewOwnerId={metadata?.reviewOwnerId}
        onThreadPress={onThreadPress}
        onReplyPress={onReplyPressFromGeneralComments}
        onCommentsChanged={handleThreadCommentChange}
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
      />
      <ConfirmationModal
        visible={!!generalDeleteState}
        onClose={generalDeleteState?.onClose ?? (() => {})}
        onConfirm={generalDeleteState?.onConfirm ?? (() => {})}
        title={t('threadsBottomSheet.deleteConfirmation.title')}
        description={t('threadsBottomSheet.deleteConfirmation.description')}
        confirmLabel={t('threadsBottomSheet.deleteConfirmation.confirm')}
        cancelLabel={t('threadsBottomSheet.deleteConfirmation.cancel')}
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
  transcriptDisclaimer: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    color: colors.ds.typography.mediumEmphasis,
    paddingHorizontal: '20@ms',
    paddingTop: '6@s',
  },
  interactionsBarContainer: {
    position: 'absolute',
    bottom: '30@vs',
    left: 0,
    right: 0,
  },
  audioPlayer: {
    marginHorizontal: '16@ms',
    marginTop: '12@ms',
    marginBottom: '4@ms',
  },
});

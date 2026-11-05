import React, {useState} from 'react';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components/Button';
import {useTranslate} from '@/hooks';
import {
  useCreateDiscussionPostMutation,
  useDeleteDiscussionPostMutation,
  useEditDiscussionPostMutation,
  useGetDiscussionQuery,
  useLockDiscussionMutation,
  useLockDiscussionPostMutation,
  useReplyToDiscussionPostMutation,
} from '@/services';
import {colors, fontFamily} from '@/theme';
import {getErrorDetails} from '@/utils/error';

import {DiscussionPost} from '../DiscussionPost';
import {PostInput} from '../PostInput';

export interface DiscussionThreadProps {
  itemId: string;
  /** Deep-linked post to scroll to / highlight, best-effort (see notification handling). */
  highlightPostId?: string | null;
  /** Bounded height for the panel — kept fixed so it never collapses each
   * item player's own `flex: 1` internal layout (see CourseItemPlayerScreen). */
  style?: object;
}

/**
 * Inline discussion thread beneath a Track 2.0 item's content. Copy:
 * "Discussion" heading + live count, empty state ("No posts yet" / "Be the
 * first to share how you'd approach this — there are no wrong answers
 * here."), composer placeholder "Share your thoughts in your own words…".
 */
export const DiscussionThread: React.FC<DiscussionThreadProps> = ({
  itemId,
  highlightPostId,
  style,
}) => {
  const {t} = useTranslate();
  const [draft, setDraft] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);

  const {data, isLoading, isError, refetch, isFetching} = useGetDiscussionQuery(
    {itemId},
  );

  const [createPost, {isLoading: isPosting}] =
    useCreateDiscussionPostMutation();
  const [replyToPost, {isLoading: isReplying}] =
    useReplyToDiscussionPostMutation();
  const [editPost, {isLoading: isEditing}] = useEditDiscussionPostMutation();
  const [deletePost] = useDeleteDiscussionPostMutation();
  const [lockPost] = useLockDiscussionPostMutation();
  const [lockDiscussion] = useLockDiscussionMutation();

  const runMutation = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setMutationError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setMutationError(getErrorDetails(err).message);
      return false;
    }
  };

  const handleSubmitPost = async () => {
    const content = draft.trim();
    const ok = await runMutation(() => createPost({itemId, content}).unwrap());
    if (ok) setDraft('');
  };

  const handleReply = (postId: string, content: string) =>
    runMutation(() => replyToPost({itemId, postId, content}).unwrap());

  const handleEdit = (postId: string, content: string) =>
    runMutation(() => editPost({itemId, postId, content}).unwrap());

  const handleDelete = (postId: string) => {
    runMutation(() => deletePost({itemId, postId}).unwrap());
  };

  const handleToggleLock = (postId: string, locked: boolean) => {
    runMutation(() => lockPost({itemId, postId, locked}).unwrap());
  };

  const handleToggleDiscussionLock = () => {
    if (!data) return;
    runMutation(() =>
      lockDiscussion({itemId, locked: !data.isLocked}).unwrap(),
    );
  };

  return (
    <View style={[styles.container, style]} testID="discussion-thread">
      <View style={styles.headerRow}>
        <Text style={styles.heading}>
          {t('courses.discussion.heading')}
          {data ? ` (${data.postCount})` : ''}
        </Text>
        {data?.viewer.canModerate ? (
          <TouchableOpacity
            testID="discussion-lock-toggle"
            onPress={handleToggleDiscussionLock}>
            <Text style={styles.moderatorAction}>
              {data.isLocked
                ? t('courses.discussion.unlockDiscussion')
                : t('courses.discussion.lockDiscussion')}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.ds.theme.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>
            {t('courses.discussion.loadFailed')}
          </Text>
          <Button
            label={t('courses.player.retry')}
            onPress={refetch}
            buttonSize="sm"
            testID="discussion-retry"
          />
        </View>
      ) : (
        <KeyboardAwareScrollView
          style={styles.flex}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          testID="keyboard-aware-scroll-view">
          {(data?.posts.length ?? 0) === 0 ? (
            <View style={styles.emptyState} testID="discussion-empty-state">
              <Text style={styles.emptyTitle}>
                {t('courses.discussion.emptyTitle')}
              </Text>
              <Text style={styles.emptyBody}>
                {t('courses.discussion.emptyBody')}
              </Text>
            </View>
          ) : (
            data?.posts.map(post => (
              <DiscussionPost
                key={post.id}
                post={post}
                maxLength={data.viewer.maxLength}
                highlightPostId={highlightPostId}
                isSubmittingReply={isReplying}
                isSubmittingEdit={isEditing}
                onReply={handleReply}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onToggleLock={handleToggleLock}
              />
            ))
          )}
          {isFetching && !isLoading ? (
            <ActivityIndicator
              style={styles.refreshingIndicator}
              size="small"
              color={colors.ds.theme.primary}
            />
          ) : null}

          {mutationError ? (
            <Text
              style={styles.mutationError}
              testID="discussion-mutation-error">
              {mutationError}
            </Text>
          ) : null}

          {data && !isLoading && !isError ? (
            data.isLocked ? (
              <Text style={styles.lockedNote} testID="discussion-locked-note">
                {t('courses.discussion.discussionLocked')}
              </Text>
            ) : data.viewer.canPost ? (
              <PostInput
                testID="discussion-composer"
                value={draft}
                onChangeText={setDraft}
                onSubmit={handleSubmitPost}
                maxLength={data.viewer.maxLength}
                isSubmitting={isPosting}
                submitLabel={t('courses.discussion.post')}
              />
            ) : null
          ) : null}
        </KeyboardAwareScrollView>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: colors.ds.stroke.primary,
    paddingHorizontal: '16@ms',
    paddingTop: '12@mvs',
    paddingBottom: '12@mvs',
    gap: '8@mvs',
  },
  flex: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '16@ms',
    color: colors.ds.typography.highEmphasis,
  },
  moderatorAction: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '12@ms',
    color: colors.ds.theme.primary,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: '20@mvs',
    gap: '10@mvs',
  },
  errorText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  listContent: {
    flexGrow: 1,
  },
  emptyState: {
    paddingVertical: '20@mvs',
    alignItems: 'center',
    gap: '4@mvs',
  },
  emptyTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.ds.typography.highEmphasis,
  },
  emptyBody: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  refreshingIndicator: {
    marginVertical: '8@mvs',
  },
  mutationError: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.ds.red[400],
  },
  lockedNote: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
    paddingVertical: '8@mvs',
  },
});

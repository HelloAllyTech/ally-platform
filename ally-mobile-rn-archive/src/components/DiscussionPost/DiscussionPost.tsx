import React, {useState} from 'react';
import {Alert, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {DeleteIcon, EditIcon, LockIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';
import {DiscussionPost as DiscussionPostModel} from '@/types';

import {PostInput} from '../PostInput';

/** Visual indent step per depth, capped — depth only ever goes to 3. */
const INDENT_STEP = 16;
const MAX_INDENT_DEPTH = 3;

const timeAgo = (iso: string): string => {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

export interface DiscussionPostProps {
  post: DiscussionPostModel;
  maxLength: number;
  highlightPostId?: string | null;
  isSubmittingReply?: boolean;
  isSubmittingEdit?: boolean;
  onReply: (postId: string, content: string) => Promise<boolean>;
  onEdit: (postId: string, content: string) => Promise<boolean>;
  onDelete: (postId: string) => void;
  onToggleLock: (postId: string, locked: boolean) => void;
}

export const DiscussionPost: React.FC<DiscussionPostProps> = ({
  post,
  maxLength,
  highlightPostId,
  isSubmittingReply = false,
  isSubmittingEdit = false,
  onReply,
  onEdit,
  onDelete,
  onToggleLock,
}) => {
  const {t} = useTranslate();
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(post.content ?? '');

  const indent = Math.min(post.depth - 1, MAX_INDENT_DEPTH - 1) * INDENT_STEP;
  const isHighlighted = !!highlightPostId && highlightPostId === post.id;

  const handleDelete = () => {
    Alert.alert(
      t('courses.discussion.deleteConfirmTitle'),
      t('courses.discussion.deleteConfirmBody'),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('courses.discussion.delete'),
          style: 'destructive',
          onPress: () => onDelete(post.id),
        },
      ],
    );
  };

  const submitReply = async () => {
    const ok = await onReply(post.id, replyText.trim());
    if (ok) {
      setReplyText('');
      setIsReplying(false);
    }
  };

  const submitEdit = async () => {
    const ok = await onEdit(post.id, editText.trim());
    if (ok) setIsEditing(false);
  };

  if (post.isDeletedByAuthor) {
    return (
      <View style={[styles.container, {marginLeft: indent}]}>
        <Text style={styles.deletedText}>
          {t('courses.discussion.deletedByAuthor')}
        </Text>
        {post.replies.map(reply => (
          <DiscussionPost
            key={reply.id}
            post={reply}
            maxLength={maxLength}
            highlightPostId={highlightPostId}
            isSubmittingReply={isSubmittingReply}
            isSubmittingEdit={isSubmittingEdit}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleLock={onToggleLock}
          />
        ))}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {marginLeft: indent},
        isHighlighted && styles.highlighted,
      ]}
      testID={`discussion-post-${post.id}`}>
      <View style={styles.headerRow}>
        <Text style={styles.author}>{post.author?.name ?? ''}</Text>
        <Text style={styles.meta}>
          {timeAgo(post.createdAt)}
          {post.isEdited
            ? post.editedByModerator
              ? ` · ${t('courses.discussion.editedByModerator')}`
              : ` · ${t('courses.discussion.edited')}`
            : ''}
        </Text>
        {post.isLocked ? (
          <View style={styles.lockBadge} testID={`post-lock-badge-${post.id}`}>
            <LockIcon
              width={12}
              height={12}
              color={colors.ds.typography.mediumEmphasis}
            />
          </View>
        ) : null}
      </View>

      {isEditing ? (
        <PostInput
          testID={`discussion-post-${post.id}-edit`}
          value={editText}
          onChangeText={setEditText}
          onSubmit={submitEdit}
          maxLength={maxLength}
          isSubmitting={isSubmittingEdit}
          submitLabel={t('courses.discussion.save')}
          onCancel={() => {
            setEditText(post.content ?? '');
            setIsEditing(false);
          }}
          autoFocus
        />
      ) : (
        <Text style={styles.content}>{post.content}</Text>
      )}

      {post.isLocked ? (
        <Text style={styles.lockedNote}>
          {t('courses.discussion.threadLocked')}
        </Text>
      ) : null}

      {!isEditing && (
        <View style={styles.actionsRow}>
          {post.canReply ? (
            <TouchableOpacity
              testID={`discussion-post-${post.id}-reply-toggle`}
              onPress={() => setIsReplying(prev => !prev)}>
              <Text style={styles.actionText}>
                {t('courses.discussion.reply')}
              </Text>
            </TouchableOpacity>
          ) : null}
          {post.canEdit ? (
            <TouchableOpacity
              testID={`discussion-post-${post.id}-edit-toggle`}
              onPress={() => setIsEditing(true)}>
              <EditIcon
                width={14}
                height={14}
                color={colors.ds.typography.mediumEmphasis}
              />
            </TouchableOpacity>
          ) : null}
          {post.canDelete ? (
            <TouchableOpacity
              testID={`discussion-post-${post.id}-delete`}
              onPress={handleDelete}>
              <DeleteIcon
                width={14}
                height={14}
                color={colors.ds.typography.mediumEmphasis}
              />
            </TouchableOpacity>
          ) : null}
          {post.canLock ? (
            <TouchableOpacity
              testID={`discussion-post-${post.id}-lock-toggle`}
              onPress={() => onToggleLock(post.id, !post.isLocked)}>
              <Text style={styles.actionText}>
                {post.isLocked
                  ? t('courses.discussion.unlockThread')
                  : t('courses.discussion.lockThread')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {isReplying ? (
        <View style={styles.replyBox}>
          <PostInput
            testID={`discussion-post-${post.id}-reply`}
            value={replyText}
            onChangeText={setReplyText}
            onSubmit={submitReply}
            maxLength={maxLength}
            isSubmitting={isSubmittingReply}
            submitLabel={t('courses.discussion.reply')}
            onCancel={() => {
              setReplyText('');
              setIsReplying(false);
            }}
            autoFocus
          />
        </View>
      ) : null}

      {post.replies.map(reply => (
        <DiscussionPost
          key={reply.id}
          post={reply}
          maxLength={maxLength}
          highlightPostId={highlightPostId}
          isSubmittingReply={isSubmittingReply}
          isSubmittingEdit={isSubmittingEdit}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleLock={onToggleLock}
        />
      ))}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingVertical: '10@mvs',
    borderTopWidth: 1,
    borderTopColor: colors.ds.stroke.primary,
    gap: '4@mvs',
  },
  highlighted: {
    backgroundColor: colors.ds.theme.onSecondary,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
  },
  author: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
  },
  meta: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    color: colors.ds.typography.lowEmphasis,
  },
  lockBadge: {
    marginLeft: '2@ms',
  },
  content: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  deletedText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontStyle: 'italic',
    color: colors.ds.typography.lowEmphasis,
    paddingVertical: '10@mvs',
  },
  lockedNote: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '16@ms',
    marginTop: '2@mvs',
  },
  actionText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '12@ms',
    color: colors.ds.theme.primary,
  },
  replyBox: {
    marginTop: '8@mvs',
  },
});

import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ms} from 'react-native-size-matters';

import {AddReactionIcon, EyeClosedIcon} from '@/assets';
import {ActionsMenu, UserProfileImage} from '@/components';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {EmojiPicker} from '../EmojiPicker';
import {styles} from './styles';
import {ReviewCommentProps} from './types';

export const ReviewComment: React.FC<ReviewCommentProps> = ({
  name,
  time,
  comment,
  profileImageUrl,
  reactions = [],
  reactionCount = 0,
  replyCount = 0,
  onReplyPress,
  onCommentPress,
  showReplyButton = true,
  onEmojiSelect,
  disableAddReactionButton = false,
  showAddReactionButton = true,
  selectedEmoji,
  hidden = false,
  currentUserId,
  commentOwnerId,
  reviewOwnerId,
  commentId,
  onEdit,
  onDelete,
  onHide,
  showActionsMenu = false,
}) => {
  const {t} = useTranslate();

  const getRepliesText = () => {
    if (replyCount === 1) {
      return t('review.details.replyLabel');
    }
    return t('review.details.comment_one', {count: replyCount});
  };

  const getMenuOptions = (): Array<{label: string; onPress: () => void}> => {
    const options: Array<{label: string; onPress: () => void}> = [];

    // Edit - only if user owns the comment
    if (
      currentUserId &&
      commentOwnerId &&
      currentUserId === commentOwnerId &&
      onEdit &&
      !hidden
    ) {
      options.push({
        label: t('review.details.edit'),
        onPress: () => onEdit(commentId || '', comment || ''),
      });
    }

    // Delete - only if user owns the comment
    if (
      currentUserId &&
      commentOwnerId &&
      currentUserId === commentOwnerId &&
      !hidden
    ) {
      options.push({
        label: t('review.details.delete'),
        onPress: () => onDelete?.(commentId || ''),
      });
    }

    // Hide - only if user is the review owner
    if (currentUserId && reviewOwnerId && currentUserId === reviewOwnerId) {
      options.push({
        label: hidden ? t('review.details.unhide') : t('review.details.hide'),
        onPress: () => onHide?.(commentId || '', !hidden),
      });
    }

    return options;
  };

  const menuOptions = getMenuOptions();

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onCommentPress}
      activeOpacity={0.7}>
      {/* Avatar */}
      <UserProfileImage
        name={name}
        profileImageUri={profileImageUrl ?? ''}
        size={36}
      />

      {/* Content */}
      <View style={styles.contentContainer}>
        {/* Header: Name and Time */}
        <View style={styles.headerRow}>
          <View style={styles.nameTimeRow}>
            <View style={styles.nameContainer}>
              <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
                {name}
              </Text>
            </View>
            <Text style={styles.timeAgo}>{time}</Text>
            {hidden && (
              <View style={styles.hiddenBadge}>
                <EyeClosedIcon width={ms(16)} height={ms(16)} />
                <Text style={styles.hiddenBadgeText}>{t('review.hidden')}</Text>
              </View>
            )}
          </View>
          {/* Actions Menu */}
          {showActionsMenu && menuOptions.length > 0 && (
            <View style={styles.actionsMenuContainer}>
              <ActionsMenu options={menuOptions} iconSize={18} />
            </View>
          )}
        </View>

        {/* Comment Text */}
        {
          <Text
            style={[styles.commentText, hidden && styles.hiddenCommentText]}>
            {comment}
          </Text>
        }

        {/* Footer: Like, Reactions, Replies */}
        <View style={[styles.footerRow, hidden && styles.hiddenFooterRow]}>
          <View style={styles.footerRowLeft}>
            {showAddReactionButton && (
              <>
                {disableAddReactionButton ? (
                  <View style={styles.likeButton}>
                    <AddReactionIcon
                      width={ms(16)}
                      height={ms(16)}
                      color={colors.ds.icon.default}
                    />
                  </View>
                ) : (
                  <View style={styles.likeButton}>
                    <EmojiPicker
                      containerOffsetX={ms(70)}
                      onEmojiSelect={onEmojiSelect || (() => {})}
                      selectedEmoji={selectedEmoji}
                    />
                  </View>
                )}
              </>
            )}
            {/* Reactions */}
            {reactions.length > 0 && (
              <View style={styles.reactionsContainer}>
                <View style={styles.reactionEmojis}>
                  {reactions.slice(0, 3).map((emoji, index) => (
                    <View
                      key={index}
                      style={[
                        styles.reactionEmojiContainer,
                        index === 0 && styles.reactionEmojiFirst,
                        index === 1 && styles.reactionEmojiSecond,
                        index === 2 && styles.reactionEmojiThird,
                      ]}>
                      <Text style={styles.reactionEmoji}>{emoji}</Text>
                    </View>
                  ))}
                </View>
                {reactionCount > 0 && (
                  <Text style={styles.reactionCount}>{reactionCount}</Text>
                )}
              </View>
            )}
          </View>

          {/* Separator Dot */}
          {(replyCount > 0 || showReplyButton) && (
            <View style={styles.separatorDot} />
          )}

          {showReplyButton && (
            <TouchableOpacity
              style={styles.repliesButton}
              onPress={onReplyPress}
              activeOpacity={0.7}
              hitSlop={10}>
              <Text style={styles.likeText}>
                {t('review.details.replyLabel')}
              </Text>
            </TouchableOpacity>
          )}

          {/* Replies */}
          {replyCount > 0 && (
            <TouchableOpacity
              style={styles.repliesButton}
              onPress={onReplyPress}
              activeOpacity={0.7}
              hitSlop={10}>
              <Text style={styles.repliesText}>{getRepliesText()}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

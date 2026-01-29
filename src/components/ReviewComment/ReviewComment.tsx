import React from 'react';
import {Image, Text, TouchableOpacity, View} from 'react-native';
import {ms} from 'react-native-size-matters';

import {AddReactionIcon} from '@/assets';
import {ActionsMenu} from '@/components/ActionsMenu/ActionsMenu';
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
  onAddReactionPress: _onAddReactionPress,
  onReplyPress,
  onCommentPress,
  showReplyButton = true,
  onEmojiSelect,
  disableAddReactionButton = false,
  showAddReactionButton = true,
  selectedEmoji,
  hidden = false,
  hiddenByName,
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
  const initials = name ? name.charAt(0).toUpperCase() : '';

  const getRepliesText = () => {
    if (replyCount === 1) {
      return t('ReviewComment.repliesOne');
    }
    return t('ReviewComment.replies', {count: replyCount});
  };

  const getMenuOptions = (): Array<{label: string; onPress: () => void}> => {
    const options: Array<{label: string; onPress: () => void}> = [];

    // Edit - only if user owns the comment
    if (
      currentUserId &&
      commentOwnerId &&
      currentUserId === commentOwnerId &&
      onEdit
    ) {
      options.push({
        label: t('ReviewComment.edit'),
        onPress: () => onEdit(commentId || '', comment || ''),
      });
    }

    // Delete - only if user owns the comment
    if (currentUserId && commentOwnerId && currentUserId === commentOwnerId) {
      options.push({
        label: t('ReviewComment.delete'),
        onPress: () => onDelete?.(commentId || ''),
      });
    }

    // Hide - only if user is the review owner
    if (currentUserId && reviewOwnerId && currentUserId === reviewOwnerId) {
      options.push({
        label: hidden ? t('ReviewComment.unhide') : t('ReviewComment.hide'),
        onPress: () => onHide?.(commentId || '', !hidden),
      });
    }

    return options;
  };

  const menuOptions = getMenuOptions();

  // Check if current user is the review owner (can see hidden comments)
  const isReviewOwner =
    currentUserId && reviewOwnerId && currentUserId === reviewOwnerId;

  // If comment is hidden and user is NOT the review owner, show minimal hidden state
  if (hidden && !isReviewOwner) {
    return (
      <View style={styles.hiddenContainer}>
        <Text style={styles.hiddenText}>
          {t('ReviewComment.hiddenBy', {name: hiddenByName || name})}
        </Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onCommentPress}
      activeOpacity={0.7}>
      {/* Avatar */}
      <View style={styles.avatarContainer}>
        {profileImageUrl ? (
          <Image
            source={{uri: profileImageUrl}}
            style={styles.avatarImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{initials}</Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.contentContainer}>
        {/* Header: Name and Time */}
        <View style={styles.headerRow}>
          <View style={styles.nameTimeRow}>
            <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
              {name}
            </Text>
            <Text style={styles.timeAgo}>{time}</Text>
            {/* Hidden Badge - only visible to review owner */}
            {hidden && isReviewOwner && (
              <View style={styles.hiddenBadge}>
                <Text style={styles.hiddenBadgeText}>
                  {t('ReviewComment.hidden')}
                </Text>
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
        <Text style={styles.commentText}>{comment}</Text>

        {/* Footer: Like, Reactions, Replies */}
        <View style={styles.footerRow}>
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
              <Text style={styles.likeText}>{t('ReviewComment.reply')}</Text>
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

import React from 'react';
import {Image, Text, TouchableOpacity, View} from 'react-native';

import {AddReactionIcon} from '@/assets/icons';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

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
  onAddReactionPress,
  onReplyPress,
  onCommentPress,
  showReplyButton = true,
}) => {
  const {t} = useTranslate();
  const initials = name ? name.charAt(0).toUpperCase() : '';

  const getRepliesText = () => {
    if (replyCount === 1) {
      return t('ReviewComment.repliesOne');
    }
    return t('ReviewComment.replies', {count: replyCount});
  };

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
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.timeAgo}>{time}</Text>
          </View>
        </View>

        {/* Comment Text */}
        <Text style={styles.commentText}>{comment}</Text>

        {/* Footer: Like, Reactions, Replies */}
        <View style={styles.footerRow}>
          <View style={styles.footerRowLeft}>
            <TouchableOpacity
              style={styles.likeButton}
              onPress={onAddReactionPress}
              activeOpacity={0.7}>
              <AddReactionIcon
                width={20}
                height={20}
                color={colors.ds.icon.default}
              />
            </TouchableOpacity>
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
              activeOpacity={0.7}>
              <Text style={styles.likeText}>{t('ReviewComment.reply')}</Text>
            </TouchableOpacity>
          )}

          {/* Replies */}
          {replyCount > 0 && (
            <TouchableOpacity
              style={styles.repliesButton}
              onPress={onReplyPress}
              activeOpacity={0.7}>
              <Text style={styles.repliesText}>{getRepliesText()}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

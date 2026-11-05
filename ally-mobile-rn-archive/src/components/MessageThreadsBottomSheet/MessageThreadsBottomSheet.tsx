import React, {useCallback, useEffect, useState} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ms} from 'react-native-size-matters';

import {ChevronRight} from '@/assets/icons';
import {BottomSheet, ReviewComment} from '@/components';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';
import {MessageThread} from '@/types/reviews';
import {formatRelativeTime} from '@/utils/date';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

import {styles} from './styles';

type Threads = MessageThread & {
  selectedText?: string;
};

export interface MessageThreadsBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  message: string;
  messageId: string;
  threads: MessageThread[];
  onThreadPress?: (threadId: string, messageId: string) => void;
}

export const MessageThreadsBottomSheet: React.FC<
  MessageThreadsBottomSheetProps
> = ({visible, onClose, message, messageId, threads = [], onThreadPress}) => {
  const {t} = useTranslate();
  const [messageThreads, setMessageThreads] = useState<Threads[]>([]);
  const isLoading = false;

  useEffect(() => {
    const mappedThreads = threads.map(thread => ({
      ...thread,
      selectedText: message.trim()
        ? message.substring(
            thread.selection?.startIndex as number,
            thread.selection?.endIndex as number,
          )
        : '',
    }));
    setMessageThreads(mappedThreads);
  }, [threads, message]);

  const renderThreadItem = useCallback(
    ({item: thread}: {item: Threads}) => {
      if (!thread.comments || thread.comments.length === 0) {
        return null;
      }

      const firstComment = thread.comments[0];
      const showMoreCommentsIndicator = thread.comments.length > 1;
      const reactionsArray = getReactionsArray(firstComment.reactions);
      const reactionCount = getTotalReactionCount(firstComment.reactions);

      return (
        <TouchableOpacity
          style={styles.threadContainer}
          onPress={() => onThreadPress?.(thread.id, messageId)}
          activeOpacity={0.7}>
          {/* Selected Text Section - if available */}
          {thread.selectedText && (
            <View style={styles.selectedTextContainer}>
              <Text
                style={styles.selectedText}
                numberOfLines={1}
                ellipsizeMode="tail">
                {t('threadsBottomSheet.selectedText')} "{thread.selectedText}"
              </Text>
            </View>
          )}

          {/* First Comment */}
          <View style={styles.commentWrapper}>
            <ReviewComment
              name={firstComment.createdBy.name}
              time={
                firstComment.createdAt
                  ? formatRelativeTime(firstComment.createdAt)
                  : ''
              }
              comment={firstComment.content}
              profileImageUrl={firstComment.createdBy.profileImage}
              reactions={reactionsArray}
              reactionCount={reactionCount}
              replyCount={firstComment.replyCount}
              showReplyButton={false}
              disableAddReactionButton
              onCommentPress={() => onThreadPress?.(thread.id, messageId)}
              hidden={firstComment.hidden}
            />
            {showMoreCommentsIndicator && (
              <LinearGradient
                colors={[
                  colors.whiteTransparent0,
                  colors.whiteTransparent40,
                  colors.whiteTransparent60,
                ]}
                start={{x: 0, y: 0}}
                end={{x: 0, y: 1}}
                locations={[0, 0.4, 0.7]}
                style={styles.gradientOverlay}
                pointerEvents="none"
              />
            )}
          </View>

          {/* More Comments Indicator */}
          {showMoreCommentsIndicator && (
            <>
              <View style={styles.separatorLine} />
              <View style={styles.moreCommentsContainer}>
                <Text style={styles.moreCommentsText}>
                  {t('threadsBottomSheet.viewMoreComments')}
                </Text>
                <ChevronRight
                  width={ms(20)}
                  height={ms(20)}
                  color={colors.ds.typography.mediumEmphasis}
                />
              </View>
            </>
          )}
        </TouchableOpacity>
      );
    },
    [onThreadPress, t, messageId],
  );

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {t('messageThreadsBottomSheet.noThreads')}
        </Text>
      </View>
    );
  }, [isLoading, t]);

  const renderHeader = useCallback(() => {
    return (
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('threadsBottomSheet.title')}</Text>
      </View>
    );
  }, [t]);

  const keyExtractor = useCallback(
    (item: MessageThread, index: number) => `${item.id}-${index}`,
    [],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      initialSnapPoint={60}
      allowFullExpand
      enablePanDownToClose
      showHandle
      skipBottomSheetView>
      <View style={styles.container}>
        {isLoading && !messageThreads ? (
          <>
            {renderHeader()}
            {renderEmpty()}
          </>
        ) : (
          <BottomSheetFlatList
            data={messageThreads}
            renderItem={renderThreadItem}
            keyExtractor={keyExtractor}
            ListHeaderComponent={renderHeader}
            ListEmptyComponent={renderEmpty}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            style={styles.listStyle}
            removeClippedSubviews={false}
          />
        )}
      </View>
    </BottomSheet>
  );
};

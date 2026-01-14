import React, {useCallback, useEffect} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms} from 'react-native-size-matters';

import {ChevronRight} from '@/assets/icons';
import {BottomSheet} from '@/components/BottomSheet';
import {ReviewComment} from '@/components/ReviewComment';
import {useTranslate} from '@/hooks';
import {useLazyGetThreadsQuery} from '@/services/reviewThreadsApi';
import {colors} from '@/theme';
import {formatDate} from '@/utils/date';

import {generateMockThreadsData} from './mockData';
import {styles} from './styles';
import {CommentsBottomSheetProps} from './types';

const LIMIT = 20;
const USE_MOCK_DATA = __DEV__;

export const CommentsBottomSheet: React.FC<CommentsBottomSheetProps> = ({
  visible,
  onClose,
  reviewId,
  onCommentPress,
  onMoreCommentsPress,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const [getThreads, {data: apiData, isLoading, isFetching}] =
    useLazyGetThreadsQuery();

  // Use mock data in development
  const mockData = USE_MOCK_DATA ? generateMockThreadsData() : null;
  const data = USE_MOCK_DATA ? mockData : apiData;

  useEffect(() => {
    if (visible && reviewId && !USE_MOCK_DATA) {
      getThreads({
        reviewId,
        offset: 0,
        limit: LIMIT,
      });
    }
  }, [visible, reviewId, getThreads]);

  const formatTimeAgo = useCallback((createdAt: string): string => {
    const now = new Date();
    const commentDate = new Date(createdAt);
    const diffMs = now.getTime() - commentDate.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
      return `${diffMins} min`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''}`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
    } else {
      return formatDate(createdAt);
    }
  }, []);

  const getReactionsArray = useCallback(
    (reactions: Record<string, number>): string[] => {
      return Object.keys(reactions).filter(key => reactions[key] > 0);
    },
    [],
  );

  const getTotalReactionCount = useCallback(
    (reactions: Record<string, number>): number => {
      return Object.values(reactions).reduce((sum, count) => sum + count, 0);
    },
    [],
  );

  const renderThreadItem = useCallback(
    ({item: thread}: {item: NonNullable<typeof data>['data'][0]}) => {
      if (!thread.comments || thread.comments.length === 0) {
        return null;
      }

      const firstComment = thread.comments[0];
      const remainingCount = thread.commentCount - 1;
      const reactionsArray = getReactionsArray(firstComment.reactions);
      const reactionCount = getTotalReactionCount(firstComment.reactions);

      return (
        <View style={styles.threadContainer}>
          {/* Selected Text Section - if available */}
          {thread.selectedText && (
            <View style={styles.selectedTextContainer}>
              <Text style={styles.selectedText}>{thread.selectedText}</Text>
            </View>
          )}

          {/* First Comment */}
          <View style={styles.commentWrapper}>
            <ReviewComment
              name={firstComment.createdBy.name}
              time={formatTimeAgo(firstComment.createdAt)}
              comment={firstComment.content}
              profileImageUrl={firstComment.createdBy.profileImage}
              reactions={reactionsArray}
              reactionCount={reactionCount}
              replyCount={firstComment.replyCount}
              showReplyButton={false}
              onCommentPress={() => onCommentPress?.(thread.id)}
            />
            {remainingCount > 0 && (
              <LinearGradient
                colors={[
                  'rgba(255, 255, 255, 0)',
                  'rgba(255, 255, 255, 0.4)',
                  'rgba(255, 255, 255, 0.6)',
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
          {remainingCount > 0 && (
            <View>
              <View style={styles.separatorLine} />
              <TouchableOpacity
                style={styles.moreCommentsContainer}
                onPress={() => onMoreCommentsPress?.(thread.id, remainingCount)}
                activeOpacity={0.7}>
                <Text style={styles.moreCommentsText}>
                  {remainingCount === 1
                    ? t('CommentsBottomSheet.moreCommentsOne')
                    : t('CommentsBottomSheet.moreComments', {
                        count: remainingCount,
                      })}
                </Text>
                <ChevronRight
                  width={ms(20)}
                  height={ms(20)}
                  color={colors.ds.typography.mediumEmphasis}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      );
    },
    [
      formatTimeAgo,
      getReactionsArray,
      getTotalReactionCount,
      onCommentPress,
      onMoreCommentsPress,
      t,
    ],
  );

  const renderHeader = useCallback(() => {
    return (
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('CommentsBottomSheet.title')}</Text>
      </View>
    );
  }, [t]);

  const renderFooter = useCallback(() => {
    if (!isFetching) return null;
    return (
      <View style={[styles.footer, {paddingBottom: insets.bottom + ms(120)}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom]);

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {t('CommentsBottomSheet.noComments')}
        </Text>
      </View>
    );
  }, [isLoading, t]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      initialSnapPoint={80}
      allowFullExpand
      skipBottomSheetView
      enableContentPanningGesture={false}
      enableDynamicSizing={false}
      enableOverDrag={false}
      overDragResistanceFactor={0}
      enableHandlePanningGesture>
      <View style={styles.container}>
        {isLoading && !data ? (
          <>
            {renderHeader()}
            {renderEmpty()}
          </>
        ) : (
          <BottomSheetFlatList
            data={data?.data || []}
            renderItem={renderThreadItem}
            keyExtractor={item => String(item.id)}
            ListHeaderComponent={renderHeader}
            ListFooterComponent={renderFooter}
            ListEmptyComponent={renderEmpty}
            contentContainerStyle={[styles.listContent]}
            showsVerticalScrollIndicator={false}
            style={{flex: 1}}
          />
        )}
      </View>
    </BottomSheet>
  );
};

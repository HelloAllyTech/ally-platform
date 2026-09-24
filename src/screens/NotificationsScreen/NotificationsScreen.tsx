import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {LeftArrowIcon} from '@/assets';
import {
  COURSE_DISCUSSION_REPLY_NOTIFICATION_TYPE,
  SCREEN_NAMES,
} from '@/constants';
import {useAppNavigation, useHardwareBackPressHandler} from '@/hooks';
import {
  NotificationItem,
  useGetNotificationsQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from '@/services/notificationsApi';
import {colors} from '@/theme';

import {styles} from './styles';

const PAGE_SIZE = 25;

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

export const NotificationsScreen: React.FC = () => {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const [limit, setLimit] = useState(PAGE_SIZE);

  const {data, isLoading, isFetching, refetch} = useGetNotificationsQuery({
    limit,
    offset: 0,
  });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead] = useMarkAllNotificationsReadMutation();

  const notifications = data?.data ?? [];
  const hasMore = (data?.count ?? 0) > notifications.length;
  const hasUnread = notifications.some(item => item.readAt === null);

  useHardwareBackPressHandler(() => {
    navigation.goBack();
    return true;
  });

  const onItemPress = useCallback(
    (item: NotificationItem) => {
      if (item.readAt === null) {
        markRead(item.id);
      }

      // Course discussion reply → open the track item player at the
      // replied-to item and (best-effort) scroll to / highlight the reply.
      if (item.type === COURSE_DISCUSSION_REPLY_NOTIFICATION_TYPE) {
        const notificationData = item.data ?? {};
        const trackId = notificationData.trackId as string | undefined;
        const itemId = notificationData.itemId as string | undefined;
        const postId = notificationData.postId as string | undefined;
        if (trackId && itemId) {
          navigation.push(SCREEN_NAMES.COURSE_ITEM_PLAYER, {
            trackId,
            itemId,
            highlightPostId: postId,
          });
        }
      }
    },
    [markRead, navigation],
  );

  const onEndReached = useCallback(() => {
    if (hasMore && !isFetching) {
      setLimit(current => current + PAGE_SIZE);
    }
  }, [hasMore, isFetching]);

  const renderItem = useCallback(
    ({item}: {item: NotificationItem}) => {
      const isUnread = item.readAt === null;
      return (
        <TouchableOpacity
          testID="notification-item"
          style={[styles.item, isUnread && styles.itemUnread]}
          onPress={() => onItemPress(item)}>
          <View style={styles.itemRow}>
            {isUnread && <View style={styles.unreadDot} testID="unread-dot" />}
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemBody} numberOfLines={3}>
                {item.body}
              </Text>
              <Text style={styles.itemTime}>{timeAgo(item.createdAt)}</Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [onItemPress],
  );

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="notifications-back"
          onPress={() => navigation.goBack()}
          style={styles.backButton}>
          <LeftArrowIcon />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {hasUnread ? (
          <TouchableOpacity
            testID="notifications-mark-all"
            onPress={() => markAllRead()}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.ds.theme.primary} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            You're all caught up — no notifications yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} />
          }
        />
      )}
    </View>
  );
};

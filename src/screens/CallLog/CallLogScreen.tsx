import React, {useCallback, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, FlatList, View} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useLazyGetCallLogsQuery} from '@/services/callsApi';
import {useAppSelector} from '@/store/hooks';
import {colors} from '@/theme/colors';
import {isEmptyObject} from '@/utils/common';

import {CallLogHeader} from './components/CallLogHeader/CallLogHeader';
import CallLogItem from './components/CallLogItem/CallLogItem';
import {CallLog} from './types';

// Number of items to fetch per page for pagination
const ITEMS_PER_PAGE = 10;

/**
 * CallLogScreen Component
 *
 * A screen component that displays a paginated list of call logs with search functionality
 * and expandable items. It handles loading states, infinite scroll, and pull-to-refresh.
 */
export const CallLogScreen: React.FC = () => {
  const [search, setSearch] = useState('');
  const [expandedIdx, setExpandedIdx] = useState(-1);
  const [offset, setOffset] = useState(0);
  const [allLogs, setAllLogs] = useState<CallLog[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const currentChat = useAppSelector(state => state.chat.currentChat);

  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();

  // RTK Query hook for fetching call logs
  const [getCallLogs, {isLoading, isFetching}] = useLazyGetCallLogsQuery();

  /**
   * Fetches the initial set of call logs
   * Sets up the initial state for pagination
   */
  const fetchInitialData = useCallback(async () => {
    const result = await getCallLogs({limit: ITEMS_PER_PAGE, offset: 0});
    if (result.data?.data) {
      // This is to avoid showing the ongoing call log
      const filteredCallLogs = result.data.data.filter(
        (log: CallLog) => log.details?.chatId !== currentChat?.chatId,
      );
      setAllLogs(filteredCallLogs);
      setHasMore(result.data.data.length === ITEMS_PER_PAGE);
    }
  }, [currentChat?.chatId, getCallLogs]);

  // Use useFocusEffect to refresh data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      setOffset(0);
      setAllLogs([]);
      setHasMore(true);
      fetchInitialData();
    }, [fetchInitialData]),
  );

  /**
   * Handles loading more call logs when user scrolls to the bottom
   * Implements infinite scroll functionality
   */
  const handleLoadMore = async () => {
    if (!hasMore || isFetching) return;

    const newOffset = offset + ITEMS_PER_PAGE;
    const result = await getCallLogs({
      limit: ITEMS_PER_PAGE,
      offset: newOffset,
    });

    if (result.data?.data) {
      setAllLogs(prev => [...prev, ...result.data.data]);
      setOffset(newOffset);
      setHasMore(result.data.data.length === ITEMS_PER_PAGE);
    }
  };

  /**
   * Handles pull-to-refresh functionality
   * Resets the list and fetches fresh data
   */
  const handleRefresh = async () => {
    setOffset(0);
    setAllLogs([]);
    setHasMore(true);
    await fetchInitialData();
  };

  const handleItemPress = (item: CallLog) => {
    navigation.navigate('CallSummary', {
      callId: item?.details?.chatId,
    });
  };

  /**
   * Toggles the expanded state of a call log item
   * @param idx - Index of the item to toggle
   */
  const handleToggle = (idx: number) => {
    setExpandedIdx(expandedIdx === idx ? -1 : idx);
  };

  // Show loading indicator when initially loading data
  if (isLoading && allLogs.length === 0) {
    return (
      <SafeAreaView style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={colors.darkSlate} />
      </SafeAreaView>
    );
  }

  /**
   * Renders individual call log items
   * @param item - Call log data
   * @param index - Index of the item in the list
   */
  const renderItem = ({item, index}: {item: CallLog; index: number}) => (
    <CallLogItem
      item={item}
      disabled={isEmptyObject(item.details?.summary)}
      expanded={expandedIdx === index}
      onToggle={() => handleToggle(index)}
      onItemPress={() => handleItemPress(item)}
    />
  );

  /**
   * Renders loading indicator at the bottom of the list
   * when fetching more data
   */
  const renderFooter = () => {
    if (!isFetching) return null;
    return (
      <ActivityIndicator
        size="small"
        color={colors.darkSlate}
        style={styles.footerLoader}
      />
    );
  };

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <CallLogHeader search={search} onSearchChange={setSearch} />

      <FlatList
        data={allLogs}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        contentContainerStyle={styles.listContent}
        renderItem={renderItem}
        style={styles.list}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={renderFooter}
        refreshing={isLoading && allLogs.length === 0}
        onRefresh={handleRefresh}
      />
    </View>
  );
};

// Styles for the component
const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  listContent: {
    paddingBottom: '100@ms',
  },
  list: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerLoader: {
    paddingVertical: '16@ms',
  },
});

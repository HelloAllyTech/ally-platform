import React, {useCallback, useMemo, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {NoCallLogsIcon, TranscribeIcon} from '@/assets/icons';
import {env} from '@/config/env';
import {CHAT_TYPES, SCREEN_NAMES} from '@/constants';
import {
  useAppNavigation,
  useCounselorChat,
  useTranslate,
  useUser,
} from '@/hooks';
import {useLazyGetCallLogsQuery} from '@/services/callsApi';
import {
  useGetSummaryFieldsQuery,
  useGetVisibleChatTypesQuery,
} from '@/services/settingsApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {setSummaryVisibleFields} from '@/store/slices/summarySlice';
import {colors, fontFamily} from '@/theme';
import {Chat, UserRole} from '@/types';
import {logger} from '@/utils/logger';

import {CallLogHeader, CallLogItem, StartSessionModal} from './components';
import {FeatureNotAvailable} from './components/FeatureNotAvailable';
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
  const [showStartSession, setShowStartSession] = useState(false);
  const {userData} = useUser();

  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const dispatch = useAppDispatch();
  const [getCallLogs, {isLoading, isFetching}] = useLazyGetCallLogsQuery();
  const {data: enabledChatTypes, isLoading: isLoadingChatTypes} =
    useGetVisibleChatTypesQuery();
  const {data: visibleFields} = useGetSummaryFieldsQuery();
  const {checkCounselorChat} = useCounselorChat();

  const isCounselor = userData?.role === UserRole.COUNSELOR;
  const hasAnyCallType = useMemo(
    () =>
      Boolean(
        enabledChatTypes?.some?.((chatType: CHAT_TYPES) =>
          [
            CHAT_TYPES.EXOTEL_CONFERENCE_CHAT,
            CHAT_TYPES.MICROPHONE_CHAT,
          ].includes(chatType),
        ),
      ),
    [enabledChatTypes],
  );

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
      if (visibleFields) {
        dispatch(setSummaryVisibleFields(visibleFields));
      }
    }, [fetchInitialData, visibleFields, dispatch]),
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

    if (result?.data?.data) {
      setAllLogs(prev => [...prev, ...(result?.data?.data || [])]);
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
    navigation.navigate(SCREEN_NAMES.CALL_SUMMARY, {
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

  /**
   * Renders individual call log items
   * @param item - Call log data
   * @param index - Index of the item in the list
   */
  const renderItem = ({item, index}: {item: CallLog; index: number}) => (
    <CallLogItem
      item={item}
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
    if (!isFetching || allLogs?.length === 0) return null;
    return (
      <ActivityIndicator
        size="small"
        color={colors.darkSlate}
        style={styles.footerLoader}
      />
    );
  };

  const handleLearnMorePress = async () => {
    try {
      await Linking.openURL(env.ALLY_WEB_URL);
    } catch (error) {
      logger.error(`Error opening learn more URL: ${error}`);
      Alert.alert('Error', 'Unable to open the link');
    }
  };

  const handleThirdPartyCall = async () => {
    checkCounselorChat().then(data => {
      const url = `tel:${env.THIRD_PARTY_CALL_NUMBER}`;
      if ((data as Chat)?.chatId) {
        Alert.alert(
          'Already in a call',
          'You are already in a call. Please end the current call to make a new one.',
          [{text: t('Common.ok')}],
        );
        return;
      }
      try {
        Linking.openURL(url);
      } catch (error) {
        logger.error(`Error opening phone call URL: ${error}`);
        Alert.alert('Error', "Can't handle phone call", [
          {text: t('Common.ok')},
        ]);
      }
    });
  };

  const handleVoiceRecording = async () => {
    checkCounselorChat();
    navigation.navigate('Listening', {isMicrophoneMode: true});
  };

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <CallLogHeader
        search={search}
        onSearchChange={setSearch}
        onRefresh={handleRefresh}
        isCounselor={isCounselor}
      />
      {!isCounselor ? (
        <FeatureNotAvailable
          description={t('CallLogs.appCurrentlyForCounsellors')}
          ctaText={t('CallLogs.learnMore')}
          onCtaPress={handleLearnMorePress}
          containerStyle={styles.featureNotAvailable}
        />
      ) : !isLoadingChatTypes && !hasAnyCallType ? (
        <FeatureNotAvailable
          description={t('CallLogs.noAccessToCallFeatures')}
          containerStyle={styles.featureNotAvailable}
        />
      ) : isLoading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.darkSlate} />
        </View>
      ) : allLogs.length === 0 && !isFetching ? (
        <View style={styles.emptyContainer}>
          <NoCallLogsIcon
            style={styles.noCallLogsIcon}
            width={160}
            height={130}
          />
          <Text style={styles.emptyText}>{t('CallLogs.noCallLogs')}</Text>
          <Text style={styles.emptyDescription}>
            {t('CallLogs.noCallLogsDescription')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={allLogs}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          contentContainerStyle={styles.listContent}
          renderItem={renderItem}
          style={styles.list}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          refreshing={false}
          onRefresh={handleRefresh}
          removeClippedSubviews
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          windowSize={5}
        />
      )}
      {isCounselor && !currentChat?.chatId && (
        <TouchableOpacity
          style={[styles.fab, {bottom: insets.bottom + ms(100)}]}
          activeOpacity={0.9}
          onPress={() => {
            setShowStartSession(true);
          }}>
          <TranscribeIcon />
        </TouchableOpacity>
      )}
      <StartSessionModal
        visible={showStartSession}
        onClose={() => setShowStartSession(false)}
        enabledChatTypes={enabledChatTypes}
        onJoinCall={handleThirdPartyCall}
        onListenLive={handleVoiceRecording}
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
  featureNotAvailable: {
    paddingHorizontal: '20@ms',
  },
  listContent: {
    paddingBottom: '100@ms',
  },
  list: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerLoader: {
    paddingVertical: '16@ms',
  },
  emptyText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '20@ms',
    lineHeight: '24@ms',
    color: colors.darkGray2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: '100@ms',
  },
  noCallLogsIcon: {
    marginBottom: '28@ms',
  },
  emptyDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '24@ms',
    color: colors.darkGray2,
    textAlign: 'center',
    marginTop: '16@vs',
    marginBottom: '30@vs',
  },
  fab: {
    position: 'absolute',
    right: '20@ms',
    padding: '20@ms',
    borderRadius: '40%',
    backgroundColor: colors.azureBlue,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});

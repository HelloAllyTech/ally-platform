import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {check, request, RESULTS} from 'react-native-permissions';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {NoCallLogsIcon, TranscribeIcon} from '@/assets/icons';
import {CallLogSkeleton} from '@/components';
import {env} from '@/config/env';
import {
  CHAT_TYPES,
  LogType,
  MICROPHONE_PERMISSION,
  SCREEN_NAMES,
  USER_PERMISSIONS,
} from '@/constants';
import {
  useAppNavigation,
  useCounselorChat,
  useHardwareBackPressHandler,
  usePermissionAlert,
  useTranslate,
  useUser,
} from '@/hooks';
import {useLazyGetCallLogsQuery} from '@/services/callsApi';
import {useLazyGetVisibleChatTypesQuery} from '@/services/settingsApi';
import {useLazyGetSimulationLogsQuery} from '@/services/simulationsApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {AppRootState} from '@/store/store';
import {colors, fontFamily} from '@/theme';
import {Chat} from '@/types';
import {isAppFeatureEnabled} from '@/utils/common';
import {logger} from '@/utils/logger';

import {
  CallLogHeader,
  CallLogItem,
  FeatureNotAvailable,
  StartSessionModal,
  TabView,
} from './components';
import {LogItem} from './types';

// Number of items to fetch per page for pagination
const ITEMS_PER_PAGE = 10;

/**
 * CallLogScreen Component
 *
 * A screen component that displays a paginated list of call logs with search functionality
 * and expandable items. It handles loading states, infinite scroll, and pull-to-refresh.
 */
export const CallLogScreen: React.FC = () => {
  const {permissions} = useAppSelector((state: AppRootState) => state.user);

  const [search, setSearch] = useState('');
  const [expandedIdx, setExpandedIdx] = useState(-1);
  const [activeTab, setActiveTab] = useState<LogType>(LogType.REAL);

  // Real call logs state
  const [realLogsOffset, setRealLogsOffset] = useState(0);
  const [allRealLogs, setAllRealLogs] = useState<LogItem[]>([]);
  const [hasMoreRealLogs, setHasMoreRealLogs] = useState(true);

  // Simulation logs state
  const [simulationLogsOffset, setSimulationLogsOffset] = useState(0);
  const [allSimulationLogs, setAllSimulationLogs] = useState<LogItem[]>([]);
  const [hasMoreSimulationLogs, setHasMoreSimulationLogs] = useState(true);

  const currentChat = useAppSelector(state => state.chat.currentChat);
  const {userData} = useUser();
  const [showStartSession, setShowStartSession] = useState(false);

  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const dispatch = useAppDispatch();
  const [getCallLogs, {isFetching: isFetchingRealLogs}] =
    useLazyGetCallLogsQuery();
  const [getSimulationLogs, {isFetching: isFetchingSimulationLogs}] =
    useLazyGetSimulationLogsQuery();
  const [getVisibleChatTypes, {data: enabledChatTypes}] =
    useLazyGetVisibleChatTypesQuery();
  const {checkCounselorChat} = useCounselorChat();
  const {showMicrophoneSettingsAlert} = usePermissionAlert();

  const canStartCall = permissions?.includes(
    USER_PERMISSIONS.VIEW_START_CALL_PAGE,
  );

  useEffect(() => {
    if (canStartCall) {
      getVisibleChatTypes();
    }
  }, [canStartCall, getVisibleChatTypes]);

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

  const availableLogTypes = useMemo(() => {
    const logTypes: LogType[] = [];

    if (permissions?.includes(USER_PERMISSIONS.VIEW_NAVBAR_CALLS)) {
      logTypes.push(LogType.REAL);
    }

    if (permissions?.includes(USER_PERMISSIONS.VIEW_SCENARIO_SESSION)) {
      logTypes.push(LogType.SIMULATION);
    }

    return logTypes;
  }, [permissions]);

  // Set initial active tab based on available permissions
  useEffect(() => {
    if (
      availableLogTypes.length > 0 &&
      !availableLogTypes.includes(activeTab)
    ) {
      setActiveTab(availableLogTypes[0]);
    }
  }, [availableLogTypes, activeTab]);

  useHardwareBackPressHandler(() => {
    BackHandler.exitApp();
    return true;
  });

  /**
   * Fetches the initial set of real call logs
   * Sets up the initial state for pagination
   */
  const fetchInitialRealLogs = useCallback(async () => {
    const result = await getCallLogs({limit: ITEMS_PER_PAGE, offset: 0});
    if (result.data?.data) {
      // This is to avoid showing the ongoing call log
      const filteredCallLogs = result.data.data.filter(
        (log: LogItem) => log.details?.chatId !== currentChat?.chatId,
      );
      setAllRealLogs(filteredCallLogs);
      setHasMoreRealLogs(result.data.data.length === ITEMS_PER_PAGE);
    } else {
      setAllRealLogs([]);
    }
  }, [currentChat?.chatId, getCallLogs]);

  /**
   * Fetches the initial set of simulation logs
   * Sets up the initial state for pagination
   */
  const fetchInitialSimulationLogs = useCallback(async () => {
    const result = await getSimulationLogs({limit: ITEMS_PER_PAGE, offset: 0});
    const logsResponse = result.data?.data;
    if (logsResponse) {
      setAllSimulationLogs(logsResponse);
      setHasMoreSimulationLogs(logsResponse.length === ITEMS_PER_PAGE);
    } else {
      setAllSimulationLogs([]);
    }
  }, [getSimulationLogs]);

  // Use useFocusEffect to refresh data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      setRealLogsOffset(0);
      setSimulationLogsOffset(0);
      setHasMoreRealLogs(true);
      setHasMoreSimulationLogs(true);

      // Only fetch data for available log types
      if (availableLogTypes.includes(LogType.REAL)) {
        fetchInitialRealLogs();
      }
      if (availableLogTypes.includes(LogType.SIMULATION)) {
        fetchInitialSimulationLogs();
      }

      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchInitialRealLogs, fetchInitialSimulationLogs, dispatch]),
  );

  /**
   * Handles loading more logs when user scrolls to the bottom
   * Implements infinite scroll functionality for both real and simulation logs
   */
  const handleLoadMore = async () => {
    if (activeTab === LogType.REAL) {
      if (!hasMoreRealLogs || isFetchingRealLogs) return;

      const newOffset = realLogsOffset + ITEMS_PER_PAGE;
      const result = await getCallLogs({
        limit: ITEMS_PER_PAGE,
        offset: newOffset,
      });

      if (result?.data?.data) {
        setAllRealLogs(prev => [...prev, ...(result?.data?.data || [])]);
        setRealLogsOffset(newOffset);
        setHasMoreRealLogs(result.data.data.length === ITEMS_PER_PAGE);
      }
    } else {
      if (!hasMoreSimulationLogs || isFetchingSimulationLogs) return;

      const newOffset = simulationLogsOffset + ITEMS_PER_PAGE;
      const result = await getSimulationLogs({
        limit: ITEMS_PER_PAGE,
        offset: newOffset,
      });
      const logsResponse = result.data?.data;
      if (logsResponse) {
        setAllSimulationLogs(prev => [...prev, ...(logsResponse || [])]);
        setSimulationLogsOffset(newOffset);
        setHasMoreSimulationLogs(logsResponse.length === ITEMS_PER_PAGE);
      }
    }
  };

  /**
   * Handles pull-to-refresh functionality
   * Resets the list and fetches fresh data for the active tab
   */
  const handleRefresh = async () => {
    if (activeTab === LogType.REAL) {
      setRealLogsOffset(0);
      setHasMoreRealLogs(true);
      await fetchInitialRealLogs();
    } else {
      setSimulationLogsOffset(0);
      setHasMoreSimulationLogs(true);
      await fetchInitialSimulationLogs();
    }
  };

  const handleItemPress = (item: LogItem) => {
    if (activeTab === LogType.REAL) {
      navigation.navigate(SCREEN_NAMES.CALL_SUMMARY, {
        callId: item?.details?.chatId,
        fromLogs: true,
      });
    } else {
      // For simulation logs, navigate to simulation summary or details
      navigation.navigate(SCREEN_NAMES.SIMULATION_FEEDBACK, {
        simulationId: item?.id?.toString(),
        fromLogs: true,
      });
    }
  };

  /**
   * Toggles the expanded state of a call log item
   * @param idx - Index of the item to toggle
   */
  const handleToggle = (idx: number) => {
    setExpandedIdx(expandedIdx === idx ? -1 : idx);
  };

  /**
   * Renders individual log items (both real and simulation logs)
   * @param item - Log data
   * @param index - Index of the item in the list
   */
  const renderItem = ({item, index}: {item: LogItem; index: number}) => {
    return (
      <CallLogItem
        item={item}
        expanded={expandedIdx === index}
        onToggle={() => handleToggle(index)}
        onItemPress={() => handleItemPress(item)}
        logType={activeTab}
      />
    );
  };

  /**
   * Renders loading indicator at the bottom of the list
   * when fetching more data
   */
  const renderFooter = () => {
    const isFetching =
      activeTab === LogType.REAL
        ? isFetchingRealLogs
        : isFetchingSimulationLogs;
    const currentLogs =
      activeTab === LogType.REAL ? allRealLogs : allSimulationLogs;

    if (!isFetching || currentLogs?.length < 10) return null;
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
    try {
      const micPermission = MICROPHONE_PERMISSION;

      // Check existing status
      const status = await check(micPermission);
      let finalStatus = status;

      // Request if not granted yet
      if (status !== RESULTS.GRANTED) {
        finalStatus = await request(micPermission);
      }

      if (finalStatus === RESULTS.GRANTED) {
        checkCounselorChat();
        navigation.navigate('Listening', {isMicrophoneMode: true});
        return;
      }

      if (finalStatus === RESULTS.BLOCKED) {
        showMicrophoneSettingsAlert();
        return;
      }

      // Denied or any other non-granted state
      showMicrophoneSettingsAlert();
    } catch (error) {
      logger.error(`Mic permission flow failed: ${error}`);
    }
  };

  // Get current logs and loading state based on active tab
  const currentLogs =
    activeTab === LogType.REAL ? allRealLogs : allSimulationLogs;
  const isFetching =
    activeTab === LogType.REAL ? isFetchingRealLogs : isFetchingSimulationLogs;
  const currentOffset =
    activeTab === LogType.REAL ? realLogsOffset : simulationLogsOffset;

  if (userData && !isAppFeatureEnabled(userData)) {
    return (
      <View style={[styles.container, {paddingTop: insets.top}]}>
        <CallLogHeader
          search={search}
          onSearchChange={setSearch}
          showTitle={false}
          isFetching={isFetchingRealLogs || isFetchingSimulationLogs}
        />
        <FeatureNotAvailable
          description={t('CallLogs.appCurrentlyForCounsellors')}
          ctaText={t('CallLogs.learnMore')}
          onCtaPress={handleLearnMorePress}
          containerStyle={styles.featureNotAvailable}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <CallLogHeader
        search={search}
        onSearchChange={setSearch}
        onRefresh={handleRefresh}
        isFetching={isFetchingRealLogs || isFetchingSimulationLogs}
      />
      {availableLogTypes.length > 1 && (
        <TabView activeTab={activeTab} onTabChange={setActiveTab} />
      )}
      {currentLogs.length === 0 && isFetching && currentOffset === 0 ? (
        <CallLogSkeleton count={10} />
      ) : currentLogs.length === 0 && !isFetching ? (
        <View style={styles.emptyContainer}>
          <NoCallLogsIcon
            style={styles.noCallLogsIcon}
            width={160}
            height={130}
          />
          <Text style={styles.emptyText}>
            {activeTab === LogType.REAL
              ? t('CallLogs.noCallLogs')
              : t('CallLogs.noSimulationLogs')}
          </Text>
          <Text style={styles.emptyDescription}>
            {activeTab === LogType.REAL
              ? t('CallLogs.noCallLogsDescription')
              : t('CallLogs.noSimulationLogsDescription')}
          </Text>
        </View>
      ) : (
        <View style={styles.listContainer}>
          <FlatList
            data={currentLogs}
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
        </View>
      )}
      {canStartCall && !currentChat?.chatId && (
        <TouchableOpacity
          style={[
            styles.fab,
            {bottom: insets.bottom + ms(100)},
            !hasAnyCallType && styles.bgAshGray,
          ]}
          disabled={!hasAnyCallType}
          activeOpacity={0.9}
          onPress={() => setShowStartSession(true)}>
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

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  listContainer: {
    flex: 1,
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
    position: 'absolute',
    top: -8,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  linearLoader: {
    marginTop: '20@ms',
  },
  footerLoader: {
    paddingVertical: '16@ms',
    alignItems: 'center',
    justifyContent: 'center',
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
    borderRadius: '30%',
    backgroundColor: colors.azureBlue,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  bgAshGray: {
    backgroundColor: colors.ashGray,
  },
});

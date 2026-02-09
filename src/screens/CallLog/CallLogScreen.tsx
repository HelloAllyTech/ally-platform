import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  NavigationProp,
  ParamListBase,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Linking,
  TouchableOpacity,
  View,
} from 'react-native';
import {check, request, RESULTS} from 'react-native-permissions';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {NoCallLogsIcon, TranscribeIcon} from '@/assets/icons';
import {CallLogSkeleton, EmptyState, TabView} from '@/components';
import {ARCHIVE_CALL_LOGS_FLAG, env} from '@/config/env';
import {
  CHAT_TYPES,
  LogType,
  MICROPHONE_PERMISSION,
  SCREEN_NAMES,
  START_CALL_PERMISSIONS,
  TAB_PERMISSIONS,
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
import {getFirstVisibleTab} from '@/navigation/TabNavigator';
import {
  useLazyGetArchivedCallLogsQuery,
  useLazyGetCallLogsQuery,
} from '@/services/callsApi';
import {
  useLazyGetSummaryFieldsQuery,
  useLazyGetVisibleChatTypesQuery,
} from '@/services/settingsApi';
import {useLazyGetSimulationLogsQuery} from '@/services/simulationsApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {
  selectSummaryVisibleFields,
  setSummaryVisibleFields,
} from '@/store/slices/summarySlice';
import {AppRootState} from '@/store/store';
import {colors} from '@/theme';
import {logger} from '@/utils/logger';

import {
  CallLogHeader,
  CallLogItem,
  FeatureNotAvailable,
  StartSessionModal,
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
  const route = useRoute();

  const [search, setSearch] = useState('');
  const [expandedIdx, setExpandedIdx] = useState(-1);
  const [activeTab, setActiveTab] = useState<LogType>(LogType.REAL);
  const [isViewingArchivedRealLogs, setIsViewingArchivedRealLogs] =
    useState<boolean>(false);

  // Real call logs state
  const [realLogsOffset, setRealLogsOffset] = useState(0);
  const [allRealLogs, setAllRealLogs] = useState<LogItem[]>([]);
  const [hasMoreRealLogs, setHasMoreRealLogs] = useState(true);

  // Archived real logs state
  const [archivedRealLogsOffset, setArchivedRealLogsOffset] = useState(0);
  const [allArchivedRealLogs, setAllArchivedRealLogs] = useState<LogItem[]>([]);
  const [hasMoreArchivedRealLogs, setHasMoreArchivedRealLogs] = useState(true);

  // Simulation logs state
  const [simulationLogsOffset, setSimulationLogsOffset] = useState(0);
  const [allSimulationLogs, setAllSimulationLogs] = useState<LogItem[]>([]);
  const [hasMoreSimulationLogs, setHasMoreSimulationLogs] = useState(true);

  const currentChat = useAppSelector(state => state.chat.currentChat);
  const {userData, checkAuth} = useUser();
  const [showStartSession, setShowStartSession] = useState(false);

  const stackNavigation = useAppNavigation();
  const tabNavigation = useNavigation<NavigationProp<ParamListBase>>();
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const dispatch = useAppDispatch();
  const [getCallLogs, {isFetching: isFetchingRealLogs}] =
    useLazyGetCallLogsQuery();
  const [getSimulationLogs, {isFetching: isFetchingSimulationLogs}] =
    useLazyGetSimulationLogsQuery();
  const [getArchivedCallLogs, {isFetching: isFetchingArchivedRealLogs}] =
    useLazyGetArchivedCallLogsQuery();
  const [getSummaryFields, {data: visibleFields}] =
    useLazyGetSummaryFieldsQuery();
  const [getVisibleChatTypes, {data: enabledChatTypes}] =
    useLazyGetVisibleChatTypesQuery();
  const {checkCounselorChat} = useCounselorChat();

  // Check if this is the first visible tab
  const isFirstTab = useMemo(() => {
    const firstTab = getFirstVisibleTab(permissions);
    return route.name === firstTab;
  }, [permissions, route.name]);
  const {showMicrophoneSettingsAlert} = usePermissionAlert();
  const visibleFieldsState = useAppSelector(selectSummaryVisibleFields);
  const showFeatureUnavailable = useMemo(() => {
    return !permissions?.some(permission =>
      TAB_PERMISSIONS.includes(permission as USER_PERMISSIONS),
    );
  }, [permissions]);

  useFocusEffect(
    useCallback(() => {
      if (!userData) {
        checkAuth();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userData]),
  );

  useEffect(() => {
    if (visibleFields) {
      dispatch(setSummaryVisibleFields(visibleFields));
    }
  }, [visibleFields, dispatch]);

  useEffect(() => {
    if (!visibleFieldsState?.length) {
      getSummaryFields();
    }
  }, [getSummaryFields, visibleFieldsState?.length]);

  const canStartCall = START_CALL_PERMISSIONS.some(permission =>
    permissions?.includes(permission),
  );

  useEffect(() => {
    if (canStartCall) {
      getVisibleChatTypes();
    }
  }, [canStartCall, getVisibleChatTypes]);

  const hasMicrophoneChatType = useMemo(
    () =>
      Boolean(
        enabledChatTypes?.some?.(
          (chatType: CHAT_TYPES) => chatType === CHAT_TYPES.MICROPHONE_CHAT,
        ),
      ),
    [enabledChatTypes],
  );

  const availableLogTypes = useMemo(() => {
    const logTypes: LogType[] = [];

    if (permissions?.includes(USER_PERMISSIONS.VIEW_CALL_LOGS)) {
      logTypes.push(LogType.REAL);
    }

    if (permissions?.includes(USER_PERMISSIONS.VIEW_SCENARIO_SESSION)) {
      logTypes.push(LogType.SIMULATION);
    }

    if (permissions?.includes(USER_PERMISSIONS.ARCHIVE_CALL_LOG)) {
      logTypes.push(LogType.ARCHIVED_REAL);
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
    if (isFirstTab) {
      // Exit app if this is the first tab
      BackHandler.exitApp();
    } else {
      // Navigate to first tab if this is not the first tab
      const firstTab = getFirstVisibleTab(permissions);
      tabNavigation.navigate(firstTab);
    }
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

  /**
   * Fetches the initial set of archived real logs
   * Sets up the initial state for pagination
   */
  const fetchInitialArchivedRealLogs = useCallback(async () => {
    const result = await getArchivedCallLogs({
      limit: ITEMS_PER_PAGE,
      offset: 0,
    });
    const logsResponse = result.data?.data;
    if (logsResponse) {
      setAllArchivedRealLogs(logsResponse);
      setHasMoreArchivedRealLogs(logsResponse.length === ITEMS_PER_PAGE);
    } else {
      setAllArchivedRealLogs([]);
    }
  }, [getArchivedCallLogs]);

  // Use useFocusEffect to refresh data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      setRealLogsOffset(0);
      setSimulationLogsOffset(0);
      setArchivedRealLogsOffset(0);
      setHasMoreRealLogs(true);
      setHasMoreSimulationLogs(true);
      setHasMoreArchivedRealLogs(true);

      // Only fetch data for available log types
      if (availableLogTypes.includes(LogType.REAL)) {
        fetchInitialRealLogs();
      }
      if (availableLogTypes.includes(LogType.SIMULATION)) {
        fetchInitialSimulationLogs();
      }
      if (availableLogTypes.includes(LogType.ARCHIVED_REAL)) {
        fetchInitialArchivedRealLogs();
      }

      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      fetchInitialRealLogs,
      fetchInitialSimulationLogs,
      fetchInitialArchivedRealLogs,
      dispatch,
    ]),
  );

  /**
   * Handles loading more logs when user scrolls to the bottom
   * Implements infinite scroll functionality for both real and simulation logs
   */
  const handleLoadMore = async () => {
    if (isViewingArchivedRealLogs) {
      if (!hasMoreArchivedRealLogs || isFetchingRealLogs) return;

      const newOffset = archivedRealLogsOffset + ITEMS_PER_PAGE;
      const result = await getArchivedCallLogs({
        limit: ITEMS_PER_PAGE,
        offset: newOffset,
      });
      if (result?.data?.data) {
        setAllArchivedRealLogs(prev => [
          ...prev,
          ...(result?.data?.data || []),
        ]);
        setArchivedRealLogsOffset(newOffset);
        setHasMoreArchivedRealLogs(result.data.data.length === ITEMS_PER_PAGE);
      }
    } else {
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
    }
  };

  /**
   * Handles pull-to-refresh functionality
   * Resets the list and fetches fresh data for the active tab
   */
  const handleRefresh = async () => {
    if (isViewingArchivedRealLogs) {
      setArchivedRealLogsOffset(0);
      setHasMoreArchivedRealLogs(true);
      await fetchInitialArchivedRealLogs();
    } else {
      if (activeTab === LogType.REAL) {
        setRealLogsOffset(0);
        setHasMoreRealLogs(true);
        await fetchInitialRealLogs();
      } else if (activeTab === LogType.SIMULATION) {
        setSimulationLogsOffset(0);
        setHasMoreSimulationLogs(true);
        await fetchInitialSimulationLogs();
      }
    }
  };

  const handleArchivePress = async () => {
    setIsViewingArchivedRealLogs(true);
  };

  const handleItemPress = (item: LogItem) => {
    if (isViewingArchivedRealLogs) {
      stackNavigation.navigate(SCREEN_NAMES.CALL_SUMMARY, {
        callId: item?.details?.chatId,
        fromLogs: true,
      });
    } else {
      if (activeTab === LogType.REAL) {
        stackNavigation.navigate(SCREEN_NAMES.CALL_SUMMARY, {
          callId: item?.details?.chatId,
          fromLogs: true,
        });
      } else {
        stackNavigation.navigate(SCREEN_NAMES.SIMULATION_FEEDBACK, {
          scenarioSessionId: item?.id?.toString(),
          fromLogs: true,
        });
      }
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
    const isDisabled =
      activeTab === LogType.REAL
        ? !permissions?.includes(USER_PERMISSIONS.VIEW_CHAT_DETAILS)
        : !permissions?.includes(
            USER_PERMISSIONS.VIEW_SCENARIO_SESSION_DETAILS,
          );

    return (
      <CallLogItem
        item={item}
        expanded={expandedIdx === index}
        disabled={isDisabled}
        onToggle={() => handleToggle(index)}
        onItemPress={() => handleItemPress(item)}
        logType={isViewingArchivedRealLogs ? LogType.ARCHIVED_REAL : activeTab}
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
        stackNavigation.navigate('Listening', {isMicrophoneMode: true});
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
  const currentLogs = isViewingArchivedRealLogs
    ? allArchivedRealLogs
    : activeTab === LogType.REAL
      ? allRealLogs
      : allSimulationLogs;
  const isFetching = isViewingArchivedRealLogs
    ? isFetchingArchivedRealLogs
    : activeTab === LogType.REAL
      ? isFetchingRealLogs
      : isFetchingSimulationLogs;
  const currentOffset = isViewingArchivedRealLogs
    ? archivedRealLogsOffset
    : activeTab === LogType.REAL
      ? realLogsOffset
      : simulationLogsOffset;

  if (showFeatureUnavailable) {
    return (
      <View style={[styles.container, {paddingTop: insets.top}]}>
        <CallLogHeader
          search={search}
          onSearchChange={setSearch}
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
        title={
          isViewingArchivedRealLogs
            ? t('CallLogs.archives.header.title')
            : t('CallLogs.header.title')
        }
        subtitle={
          !isViewingArchivedRealLogs ? t('CallLogs.header.subtitle') : ''
        }
        search={search}
        onSearchChange={setSearch}
        onRefresh={handleRefresh}
        showBackButton={isViewingArchivedRealLogs}
        onGoBack={() => setIsViewingArchivedRealLogs(false)}
        onArchivePress={handleArchivePress}
        isFetching={isFetchingRealLogs || isFetchingSimulationLogs}
        showActionsMenu={!isViewingArchivedRealLogs && ARCHIVE_CALL_LOGS_FLAG}
      />
      {availableLogTypes.length > 1 && !isViewingArchivedRealLogs && (
        <View style={styles.tabMargin}>
          <TabView
            tabs={[
              {key: LogType.REAL, label: t('CallLogs.realCallLogs')},
              {key: LogType.SIMULATION, label: t('CallLogs.simulations')},
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </View>
      )}
      {currentLogs.length === 0 && isFetching && currentOffset === 0 ? (
        <CallLogSkeleton count={10} />
      ) : currentLogs.length === 0 && !isFetching ? (
        <EmptyState
          icon={NoCallLogsIcon}
          title={
            activeTab === LogType.REAL
              ? t('CallLogs.noCallLogs')
              : t('CallLogs.noSimulationLogs')
          }
          description={
            activeTab === LogType.REAL
              ? t('CallLogs.noCallLogsDescription')
              : t('CallLogs.noSimulationLogsDescription')
          }
          containerStyle={styles.emptyStateContainer}
        />
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
            !hasMicrophoneChatType && styles.bgAshGray,
          ]}
          disabled={!hasMicrophoneChatType}
          activeOpacity={0.9}
          onPress={() => setShowStartSession(true)}>
          <TranscribeIcon />
        </TouchableOpacity>
      )}
      <StartSessionModal
        visible={showStartSession}
        onClose={() => setShowStartSession(false)}
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
  tabMargin: {
    marginHorizontal: '24@ms',
    marginVertical: '16@ms',
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
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

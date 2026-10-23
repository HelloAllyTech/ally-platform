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
import {CallLogSkeleton, EmptyState, TabView, useToast} from '@/components';
import {env} from '@/config/env';
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
  useScribeNoteCreationEnabled,
  useTranslate,
  useUser,
} from '@/hooks';
import {getFirstVisibleTab} from '@/navigation/TabNavigator';
import {
  useGetCallTagsQuery,
  useLazyGetCallLogsQuery,
} from '@/services/callsApi';
import {useGetCustomFieldDefinitionsQuery} from '@/services/customFieldsApi';
import {useCreateNoteMutation} from '@/services/scribeNoteApi';
import {useLazyGetVisibleChatTypesQuery} from '@/services/settingsApi';
import {useLazyGetSimulationLogsQuery} from '@/services/simulationsApi';
import {useAppSelector} from '@/store/hooks';
import {AppRootState} from '@/store/store';
import {colors} from '@/theme';
import {logger} from '@/utils/logger';

import {
  CallLogFilterSheet,
  CallLogHeader,
  CallLogItem,
  FeatureNotAvailable,
  StartSessionModal,
} from './components';
import {LogItem} from './types';
import {
  buildBuiltinParams,
  buildFieldFiltersParam,
  countActiveFilters,
  FilterState,
} from './utils/fieldFilters';

// Number of items to fetch per page for pagination
const ITEMS_PER_PAGE = 10;

// Long enough that a counsellor reading the OS permission dialog is never cut
// off — the request only resolves once they answer it — and short enough that a
// call which is never going to answer stops pretending to work.
const PERMISSION_TIMEOUT_MS = 30000;

/**
 * Rejects if a permission call has not settled in time. `react-native-permissions`
 * resolves against native state, and a native side that never replies leaves the
 * promise pending for the life of the process with nothing to show for it.
 */
const withPermissionTimeout = <T,>(
  promise: Promise<T>,
  stage: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `microphone permission ${stage}() did not settle in time`,
            ),
          ),
        PERMISSION_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
};

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
  const [filterState, setFilterState] = useState<FilterState>({});
  const [showFilterSheet, setShowFilterSheet] = useState(false);
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
  const [isStartingScribe, setIsStartingScribe] = useState(false);

  const stackNavigation = useAppNavigation();
  const tabNavigation = useNavigation<NavigationProp<ParamListBase>>();
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const [getCallLogs, {isFetching: isFetchingRealLogs}] =
    useLazyGetCallLogsQuery();
  const [getSimulationLogs, {isFetching: isFetchingSimulationLogs}] =
    useLazyGetSimulationLogsQuery();
  const [
    getVisibleChatTypes,
    {data: enabledChatTypes, isFetching: isFetchingChatTypes},
  ] = useLazyGetVisibleChatTypesQuery();
  const {checkCounselorChat} = useCounselorChat();

  const canViewCallLogs = permissions?.includes(
    USER_PERMISSIONS.VIEW_CALL_LOGS,
  );
  const {data: customFieldDefs = []} = useGetCustomFieldDefinitionsQuery(
    undefined,
    {
      skip: !canViewCallLogs,
    },
  );
  const {data: tagsData} = useGetCallTagsQuery(undefined, {
    skip: !canViewCallLogs,
  });
  const tagOptions = useMemo(
    () => (tagsData?.data ?? []).map(tag => ({label: tag, value: tag})),
    [tagsData],
  );
  const fieldFiltersParam = useMemo(
    () => buildFieldFiltersParam(filterState),
    [filterState],
  );
  const builtinParams = useMemo(
    () => buildBuiltinParams(filterState),
    [filterState],
  );
  const activeFilterCount = countActiveFilters(filterState);

  // Check if this is the first visible tab
  const isFirstTab = useMemo(() => {
    const firstTab = getFirstVisibleTab(permissions);
    return route.name === firstTab;
  }, [permissions, route.name]);
  const {showMicrophoneSettingsAlert} = usePermissionAlert();
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

  const canStartCall = START_CALL_PERMISSIONS.some(permission =>
    permissions?.includes(permission),
  );

  /**
   * Re-ask on every focus, not once per mount.
   *
   * This drove the "the blue button does nothing" reports. Both of the flags the
   * start button is gated on come from settings requests, and when the access
   * token rotates every request in flight returns 401 at once — production shows
   * `/settings/chat-types`, `/settings/scribe-note-creation-enabled`,
   * `/users/me` and `/chats/call-logs` all failing in the same millisecond. This
   * effect's dependencies are both stable, so it fired once, and nothing ever
   * retried it. `canStartCall` comes from persisted permissions, so the button
   * still rendered — visible, blue, and permanently inert until the app was
   * restarted. Refetching on focus recovers it once the token does.
   */
  useFocusEffect(
    useCallback(() => {
      if (canStartCall) {
        getVisibleChatTypes();
      }
    }, [canStartCall, getVisibleChatTypes]),
  );

  const hasMicrophoneChatType = useMemo(
    () =>
      Boolean(
        enabledChatTypes?.some?.(
          (chatType: CHAT_TYPES) => chatType === CHAT_TYPES.MICROPHONE_CHAT,
        ),
      ),
    [enabledChatTypes],
  );

  // Manual scribe notes: counsellor permission + per-tenant toggle (the hook
  // skips the request for non-counsellors, so data stays undefined for them).
  const {data: scribeNoteCreationEnabled} = useScribeNoteCreationEnabled();
  const canCreateNote =
    Boolean(permissions?.includes(USER_PERMISSIONS.COUNSELOR_ACCESS)) &&
    Boolean(scribeNoteCreationEnabled);

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
    const result = await getCallLogs({
      limit: ITEMS_PER_PAGE,
      offset: 0,
      archive: false,
      fieldFilters: fieldFiltersParam,
      ...builtinParams,
    });
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
  }, [currentChat?.chatId, getCallLogs, fieldFiltersParam, builtinParams]);

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
    const result = await getCallLogs({
      limit: ITEMS_PER_PAGE,
      offset: 0,
      archive: true,
      fieldFilters: fieldFiltersParam,
      ...builtinParams,
    });
    const logsResponse = result.data?.data;
    if (logsResponse) {
      setAllArchivedRealLogs(logsResponse);
      setHasMoreArchivedRealLogs(logsResponse.length === ITEMS_PER_PAGE);
    } else {
      setAllArchivedRealLogs([]);
    }
  }, [getCallLogs, fieldFiltersParam, builtinParams]);

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
      const result = await getCallLogs({
        limit: ITEMS_PER_PAGE,
        offset: newOffset,
        archive: true,
        fieldFilters: fieldFiltersParam,
        ...builtinParams,
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
          archive: false,
          fieldFilters: fieldFiltersParam,
          ...builtinParams,
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

  // Applying filters updates filterState → fieldFiltersParam → the fetch
  // callbacks' identities change, so the focus effect re-runs and refetches
  // page 0 with the new filters.
  const handleApplyFilters = (state: FilterState) => {
    setFilterState(state);
  };

  // The filter button/sheet apply only to real (incl. archived) call logs, not
  // simulations. Built-in column filters are always available, so gate only on
  // the view + permission.
  const showFilterAction =
    !!canViewCallLogs &&
    (isViewingArchivedRealLogs || activeTab === LogType.REAL);

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
      Alert.alert(t('common.error'), t('common.unableToOpenLink'));
    }
  };

  const {showToast} = useToast();
  const [createNote, {isLoading: isCreatingNote}] = useCreateNoteMutation();

  // Creates an empty manual note and opens it in the summary screen, where the
  // counsellor fills the fields (typed or via voice dictation).
  const handleCreateNote = async () => {
    try {
      const {chatId} = await createNote().unwrap();
      setShowStartSession(false);
      stackNavigation.navigate(SCREEN_NAMES.CALL_SUMMARY, {
        callId: chatId,
        fromLogs: true,
      });
    } catch (error) {
      logger.error(`Create note failed: ${error}`);
      showToast(t('calls.createNote.error'), 'error');
    }
  };

  /**
   * Starting a scribe session used to be able to stop dead here with nothing on
   * screen at all.
   *
   * The counsellor taps "Start Scribe Mode", the sheet closes, and the two
   * permission calls below are awaited with no timeout and no visible state. If
   * either never settles, this function simply never reaches `navigate`: no
   * screen, no socket, no error, no log — the app looks frozen, and the only way
   * out is to force-quit it. Production bears that out. Across three days of the
   * reported failures the listening screen never once opened its socket, so the
   * tap was never getting past this point.
   *
   * So: bound both calls, keep the sheet up with a spinner while they run, and
   * fail loudly if they don't answer. That does not identify which call is at
   * fault, but it converts a silent freeze into a bounded wait the counsellor
   * can act on — and the toast tells us it happened at all, which nothing did
   * before.
   */
  /**
   * True when neither session type is on offer, and false-because-we-do-not-know
   * is kept separate from false-because-the-tenant-disabled-it. The first is a
   * failed settings request and must not present as a disabled control.
   */
  const canOfferAnySessionType = hasMicrophoneChatType || canCreateNote;
  const isSessionTypeUnknown = !enabledChatTypes;

  const handleStartSessionPress = () => {
    if (isSessionTypeUnknown) {
      // Never a dead tap: re-ask, and say so rather than doing nothing.
      if (!isFetchingChatTypes) {
        getVisibleChatTypes();
      }
      if (!canOfferAnySessionType) {
        showToast(t('common.somethingWentWrong'), 'error');
        return;
      }
    }
    setShowStartSession(true);
  };

  const handleVoiceRecording = async () => {
    // A second tap while the first is still resolving must not start a parallel
    // flow — that is how two sessions got created seconds apart before.
    if (isStartingScribe) return;
    setIsStartingScribe(true);

    try {
      const micPermission = MICROPHONE_PERMISSION;

      // Check existing status
      const status = await withPermissionTimeout(check(micPermission), 'check');
      let finalStatus = status;

      // Request if not granted yet
      if (status !== RESULTS.GRANTED) {
        finalStatus = await withPermissionTimeout(
          request(micPermission),
          'request',
        );
      }

      // NOTE: the sheet already closed itself on tap. Do not close it here —
      // that put its unmount in the same synchronous block as navigate() and
      // froze Android. See StartSessionModal.handleStartScribe.
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
      showToast(t('common.somethingWentWrong'), 'error');
    } finally {
      setIsStartingScribe(false);
    }
  };

  // Get current logs and loading state based on active tab
  const currentLogs = isViewingArchivedRealLogs
    ? allArchivedRealLogs
    : activeTab === LogType.REAL
      ? allRealLogs
      : allSimulationLogs;
  const isFetching = isViewingArchivedRealLogs
    ? isFetchingRealLogs
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
          description={t('calls.appCurrentlyForCounsellors')}
          ctaText={t('calls.learnMore')}
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
            ? t('calls.menu.archives')
            : t('calls.header.title')
        }
        subtitle={!isViewingArchivedRealLogs ? t('calls.header.subtitle') : ''}
        search={search}
        onSearchChange={setSearch}
        onRefresh={handleRefresh}
        showBackButton={isViewingArchivedRealLogs}
        onGoBack={() => setIsViewingArchivedRealLogs(false)}
        onArchivePress={handleArchivePress}
        onFilterPress={
          showFilterAction ? () => setShowFilterSheet(true) : undefined
        }
        activeFilterCount={activeFilterCount}
        isFetching={isFetchingRealLogs || isFetchingSimulationLogs}
        showActionsMenu={
          !isViewingArchivedRealLogs &&
          activeTab === LogType.REAL &&
          permissions?.includes(USER_PERMISSIONS.ARCHIVE_CALL_LOG)
        }
      />
      {availableLogTypes.includes(LogType.REAL) &&
        availableLogTypes.includes(LogType.SIMULATION) &&
        !isViewingArchivedRealLogs && (
          <View style={styles.tabMargin}>
            <TabView
              tabs={[
                {key: LogType.REAL, label: t('analytics.types.callLogs')},
                {key: LogType.SIMULATION, label: t('analytics.types.rolePlay')},
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
              ? t('calls.fallback.callEmptyTitle')
              : t('calls.fallback.simEmptyTitle')
          }
          description={
            activeTab === LogType.REAL
              ? t('audioCall.fallback.noActiveCallDesc')
              : t('audioCall.fallback.noActiveCallDesc')
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
      {(canStartCall || canCreateNote) && !currentChat?.chatId && (
        <TouchableOpacity
          style={[
            styles.fab,
            {bottom: insets.bottom + ms(100)},
            !canOfferAnySessionType && styles.bgAshGray,
          ]}
          /*
           * Only inert when we actually KNOW there is nothing to offer. While
           * the settings answer is missing — the usual cause being a 401 burst
           * on token rotation — the button stays live and the press retries the
           * request, because a blue button that silently does nothing is the bug
           * being reported.
           */
          disabled={!canOfferAnySessionType && !isSessionTypeUnknown}
          activeOpacity={0.9}
          testID="start-session-fab"
          onPress={handleStartSessionPress}>
          <TranscribeIcon />
        </TouchableOpacity>
      )}
      <StartSessionModal
        visible={showStartSession}
        onClose={() => setShowStartSession(false)}
        onListenLive={handleVoiceRecording}
        hasMicrophoneChatType={hasMicrophoneChatType}
        showCreateNote={canCreateNote}
        onCreateNote={handleCreateNote}
        isCreatingNote={isCreatingNote}
        isStartingScribe={isStartingScribe}
      />
      <CallLogFilterSheet
        visible={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        definitions={customFieldDefs}
        tagOptions={tagOptions}
        appliedState={filterState}
        onApply={handleApplyFilters}
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

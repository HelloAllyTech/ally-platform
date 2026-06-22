import React, {useCallback, useMemo, useState} from 'react';
import {
  NavigationProp,
  ParamListBase,
  useIsFocused,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import {Trans, useTranslation} from 'react-i18next';
import {BackHandler, FlatList, RefreshControl, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';
import {useSelector} from 'react-redux';

import {BoltIcon} from '@/assets';
import {
  BadgePopup,
  CircularProgress,
  SimulationCard,
  SimulationsSkeleton,
  TabScreenHeader,
  TabView,
} from '@/components';
import {isIOS, SCREEN_NAMES, SimulationTabs} from '@/constants';
import {
  useAppNavigation,
  useHardwareBackPressHandler,
  useSimulationCredits,
} from '@/hooks';
import {getFirstVisibleTab} from '@/navigation/TabNavigator';
import {
  useGetCasesQuery,
  useGetScenariosQuery,
  useGetSimulationPathsQuery,
} from '@/services';
import {AppRootState} from '@/store/store';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import type {Case, Scenario, SimulationPath} from '@/types';
import {getTriggerWarningNames} from '@/utils';

export const SimulationsScreen: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const tabNavigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute();
  const isFocused = useIsFocused();
  const permissions = useSelector((s: AppRootState) => s.user.permissions);
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<SimulationTabs>(
    SimulationTabs.SIMULATIONS,
  );

  const {
    data: scenariosData,
    isFetching: isFetchingScenarios,
    refetch: refetchScenarios,
  } = useGetScenariosQuery();

  const {
    data: pathsData,
    isFetching: isFetchingPaths,
    refetch: refetchPaths,
  } = useGetSimulationPathsQuery();

  const {
    data: casesData,
    isFetching: isFetchingCases,
    refetch: refetchCases,
  } = useGetCasesQuery();

  const {credits, getCreditsInfo} = useSimulationCredits();

  const keyExtractor = (item: Scenario | SimulationPath | Case) =>
    item.id?.toString();

  // Check if this is the first visible tab
  const isFirstTab = useMemo(() => {
    const firstTab = getFirstVisibleTab(permissions);
    return route.name === firstTab;
  }, [permissions, route.name]);

  // Handle back press: exit app if first tab, otherwise navigate to first tab
  useHardwareBackPressHandler(
    useCallback(() => {
      if (isFocused) {
        if (isFirstTab) {
          BackHandler.exitApp();
        } else {
          const firstTab = getFirstVisibleTab(permissions);
          tabNavigation.navigate(firstTab);
        }
        return true;
      }
      return false;
    }, [isFocused, isFirstTab, permissions, tabNavigation]),
  );

  const handleScenarioPress = (scenario: Scenario) => {
    navigation.navigate(SCREEN_NAMES.SIMULATION_DETAILS, {scenario});
  };

  const handlePathPress = (path: SimulationPath) => {
    navigation.navigate(SCREEN_NAMES.SIMULATION_PATH_DETAILS, {
      pathId: path.id,
    });
  };

  const handleCasePress = (caseItem: Case) => {
    navigation.navigate(SCREEN_NAMES.CASE_DETAILS, {
      caseId: caseItem.id,
    });
  };

  const handleRefresh = () => {
    if (activeTab === SimulationTabs.SIMULATIONS) {
      refetchScenarios();
    } else if (activeTab === SimulationTabs.PATHS) {
      refetchPaths();
    } else {
      refetchCases();
    }
  };

  const renderSimulationItem = ({item}: {item: Scenario}) => {
    return (
      <SimulationCard
        title={item.title}
        description={item.description || ''}
        coverImageUrl={item.coverImageUrl}
        onPress={() => handleScenarioPress(item)}
        triggerWarnings={getTriggerWarningNames(item.triggerWarnings)}
      />
    );
  };

  const renderPathItem = ({item}: {item: SimulationPath}) => {
    const progress = item.completedScenarios;
    const total = item.totalScenarios;
    const showProgress = !!progress && !!total;
    const isCompleted = !!progress && progress >= total;

    return (
      <SimulationCard
        title={item.title}
        description={`${total} ${t('calls.table.scenario')}`}
        coverImageUrl={item.coverImageUrl}
        onPress={() => handlePathPress(item)}
        rightAccessory={
          showProgress ? (
            <View style={styles.progressContainer}>
              <CircularProgress
                progress={progress}
                max={total}
                size={33}
                strokeWidth={3}
                progressColor={
                  isCompleted ? colors.ds.green[400] : colors.blue
                }>
                <Text style={styles.progressText}>
                  {progress}/{total}
                </Text>
              </CircularProgress>
            </View>
          ) : null
        }
      />
    );
  };

  const renderCaseItem = ({item}: {item: Case}) => {
    const progress = item.completedScenarios;
    const total = item.totalScenarios;
    const showProgress = !!progress && !!total;
    const isCompleted = !!progress && progress >= total;

    return (
      <SimulationCard
        title={item.title}
        description={`${total} ${t('calls.table.scenario')}`}
        coverImageUrl={item.coverImageUrl}
        onPress={() => handleCasePress(item)}
        rightAccessory={
          showProgress ? (
            <View style={styles.progressContainer}>
              <CircularProgress
                progress={progress}
                max={total}
                size={33}
                strokeWidth={3}
                progressColor={
                  isCompleted ? colors.ds.green[400] : colors.blue
                }>
                <Text style={styles.progressText}>
                  {progress}/{total}
                </Text>
              </CircularProgress>
            </View>
          ) : null
        }
      />
    );
  };

  const ListEmptyElement = useMemo(
    () => (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>
          {activeTab === SimulationTabs.SIMULATIONS
            ? t('simulationPage.noSimulationsAvailable')
            : activeTab === SimulationTabs.PATHS
              ? t('simulationPage.noPathsAvailable')
              : t('simulationPage.noCasesAvailable')}
        </Text>
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab],
  );

  const renderCreditsDisplay = () => {
    if (!credits || !getCreditsInfo) return null;

    return (
      <View style={styles.creditDisplay}>
        <BoltIcon width={14} height={14} />
        <Text
          style={[
            styles.creditText,
            getCreditsInfo.isLow && styles.creditTextLow,
          ]}>
          {credits.consumedCredits}
          <Text style={styles.creditLimitText}>/{credits.creditLimit}</Text>
        </Text>
      </View>
    );
  };

  const renderHeader = () => {
    return (
      <TabScreenHeader
        title={t('common.appName')}
        subtitle={t('nav.tabs.learn')}
        italicSubtitle
        rightContent={renderCreditsDisplay()}
      />
    );
  };

  const renderTabContent = () => {
    const isSimulationsTab = activeTab === SimulationTabs.SIMULATIONS;
    const isPathsTab = activeTab === SimulationTabs.PATHS;
    const isCasesTab = activeTab === SimulationTabs.CASES;

    const isFetching = isSimulationsTab
      ? isFetchingScenarios
      : isPathsTab
        ? isFetchingPaths
        : isFetchingCases;

    const tabLabel = isSimulationsTab
      ? 'simulation'
      : isPathsTab
        ? 'track'
        : 'case';

    return (
      <>
        <Text style={styles.listTitle}>
          {t('learn.choose.prefix')}{' '}
          <Text style={styles.pageTitleItalic}>
            {t(`simulations.${tabLabel}`)}
          </Text>
        </Text>
        {isSimulationsTab ? (
          <FlatList
            contentContainerStyle={styles.list}
            data={scenariosData ?? []}
            keyExtractor={keyExtractor}
            renderItem={renderSimulationItem}
            ListEmptyComponent={
              !isFetching ? ListEmptyElement : <SimulationsSkeleton count={4} />
            }
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isFetching}
                onRefresh={handleRefresh}
              />
            }
          />
        ) : isPathsTab ? (
          <FlatList
            contentContainerStyle={styles.list}
            data={pathsData ?? []}
            keyExtractor={keyExtractor}
            renderItem={renderPathItem}
            ListEmptyComponent={
              !isFetching ? ListEmptyElement : <SimulationsSkeleton count={4} />
            }
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isFetching}
                onRefresh={handleRefresh}
              />
            }
          />
        ) : (
          <FlatList
            contentContainerStyle={styles.list}
            data={casesData ?? []}
            keyExtractor={keyExtractor}
            renderItem={renderCaseItem}
            ListEmptyComponent={
              !isFetching ? ListEmptyElement : <SimulationsSkeleton count={4} />
            }
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isFetching}
                onRefresh={handleRefresh}
              />
            }
          />
        )}
      </>
    );
  };

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      {renderHeader()}
      <View style={styles.marginH21}>
        <View style={styles.introWrapper}>
          <Text style={styles.introText}>
            <Trans
              i18nKey="simulations.learnIntro"
              components={{
                blue: <Text style={styles.blueBold} />,
              }}
            />
          </Text>
        </View>
        <View style={styles.tabMargin}>
          <TabView
            tabs={[
              {
                key: SimulationTabs.SIMULATIONS,
                label: t('simulations.simulation'),
              },
              {
                key: SimulationTabs.PATHS,
                label: t('simulations.tracks'),
              },
              {
                key: SimulationTabs.CASES,
                label: t('simulations.cases'),
              },
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </View>
        {renderTabContent()}
      </View>
      <BadgePopup />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  list: {
    paddingTop: '10@ms',
    paddingBottom: '360@ms',
    gap: '10@ms',
  },
  empty: {
    alignItems: 'center',
    marginTop: '40@ms',
    gap: '6@ms',
  },
  emptyTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '16@ms',
  },
  listTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    fontWeight: fontWeights.medium,
    color: colors.darkGray12,
    textAlign: 'center',
    marginBottom: '10@ms',
  },
  pageTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontWeight: fontWeights.medium,
    fontStyle: isIOS ? 'italic' : 'normal',
  },
  introWrapper: {
    marginTop: '22@ms',
  },
  introText: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    fontWeight: fontWeights.light,
    color: colors.darkSlate,
    textAlign: 'center',
  },
  blueBold: {
    ...fontFamily.REPLAY_PRO.BOLD,
    fontWeight: fontWeights.medium,
    color: colors.azureBlue,
  },
  creditDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  creditText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.display.small,
    fontWeight: fontWeights.medium,
  },
  creditTextLow: {
    color: colors.ds.red[300],
  },
  creditLimitText: {
    ...typography.body.tiny,
    color: colors.darkGray,
  },
  marginH21: {
    marginHorizontal: '21@ms',
  },
  progressContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.nano,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  tabMargin: {
    marginVertical: '16@ms',
  },
});

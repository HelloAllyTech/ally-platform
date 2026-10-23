import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, ScrollView, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';
import WebView from 'react-native-webview';

import {DataUnavailableIcon} from '@/assets/icons';
import {EmptyState, TabScreenHeader, TabView} from '@/components';
import {AnalyticsType} from '@/constants/analytics';
import {SCREEN_WIDTH} from '@/constants/general';
import {useTabBackToHomeHandler, useTranslate, useUser} from '@/hooks';
import {
  useGetDashboardsQuery,
  useLazyGetDashboardUrlQuery,
} from '@/services/analyticsApi';
import {colors, fontFamily, typography} from '@/theme';

export const UserAnalyticsScreen: React.FC = () => {
  const {t} = useTranslate();
  const {userData} = useUser();
  useTabBackToHomeHandler();
  const [activeTab, setActiveTab] = useState<AnalyticsType>(
    AnalyticsType.CALL_LOG_ANALYTICS,
  );

  const [getDashboardUrl] = useLazyGetDashboardUrlQuery();
  const {
    data: dashboards,
    isLoading: isLoadingDashboards,
    error,
  } = useGetDashboardsQuery(undefined, {
    skip: !userData?.id,
    refetchOnMountOrArgChange: true,
  });

  const [dashboardUrls, setDashboardUrls] = useState<{[id: string]: string}>(
    {},
  );

  const triggerDashboardUrl = useCallback(
    async (dashboardId: string) => {
      const result = await getDashboardUrl({dashboardId});
      const url = result.data?.url;
      if (url) {
        setDashboardUrls(prev => ({
          ...prev,
          [dashboardId]: url,
        }));
      }
    },
    [getDashboardUrl],
  );

  useEffect(() => {
    if (dashboards) {
      dashboards.forEach(({externalId}) => {
        triggerDashboardUrl(externalId);
      });
    }
  }, [dashboards, triggerDashboardUrl]);

  useEffect(() => {
    setDashboardUrls({});
  }, [userData?.id]);

  const presentTypes = useMemo(() => {
    const types = new Set<AnalyticsType>();
    dashboards?.forEach(d => {
      if (d.analyticsType === AnalyticsType.CALL_LOG_ANALYTICS) {
        types.add(AnalyticsType.CALL_LOG_ANALYTICS);
      } else if (d.analyticsType === AnalyticsType.SIMULATION_ANALYTICS) {
        types.add(AnalyticsType.SIMULATION_ANALYTICS);
      }
    });
    return types;
  }, [dashboards]);

  // If only one type exists, lock the active tab to that type
  useEffect(() => {
    if (presentTypes.size === 1) {
      const onlyType = presentTypes.values().next().value as AnalyticsType;
      if (onlyType && onlyType !== activeTab) {
        setActiveTab(onlyType);
      }
    }
  }, [presentTypes, activeTab]);

  // Filter dashboards by current tab's analytics type
  const filteredDashboards = useMemo(() => {
    return dashboards?.filter(d => d.analyticsType === activeTab) ?? [];
  }, [dashboards, activeTab]);

  const renderLoading = () => {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.azureBlue} />
      </View>
    );
  };

  if (isLoadingDashboards) {
    return renderLoading();
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>
            {t('analytics.empty.description')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Show tabs only if both analytics types are present */}
      <TabScreenHeader
        title={t('analytics.title')}
        subtitle={t('analytics.dashboardTitle')}
      />
      {!isLoadingDashboards && !dashboards?.length && (
        <View style={styles.emptyStateContainer}>
          <EmptyState
            icon={DataUnavailableIcon}
            title={t('analytics.empty.title')}
            description={t('analytics.empty.description')}
          />
        </View>
      )}
      {presentTypes.has(AnalyticsType.CALL_LOG_ANALYTICS) &&
        presentTypes.has(AnalyticsType.SIMULATION_ANALYTICS) && (
          <View style={styles.tabMargin}>
            <TabView<AnalyticsType>
              tabs={[
                {
                  key: AnalyticsType.CALL_LOG_ANALYTICS,
                  label: t('analytics.types.callLogs'),
                },
                {
                  key: AnalyticsType.SIMULATION_ANALYTICS,
                  label: t('analytics.types.simulations'),
                },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          </View>
        )}

      {!!dashboards?.length && (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={
            Object.keys(dashboardUrls).length === 0 &&
            dashboards &&
            dashboards.length > 0
              ? styles.loadingContent
              : styles.content
          }
          showsVerticalScrollIndicator={false}>
          {Object.keys(dashboardUrls).length === 0 &&
          dashboards &&
          dashboards.length > 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.azureBlue} />
            </View>
          ) : (
            filteredDashboards.map(dashboard => {
              const url = dashboardUrls[dashboard.externalId];
              if (!url) return null;

              return (
                <View
                  key={dashboard.externalId}
                  style={styles.webViewContainer}>
                  <WebView
                    source={{uri: url}}
                    style={styles.webView}
                    startInLoadingState
                  />
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: '40@s',
    backgroundColor: colors.white,
  },
  content: {
    flex: 1,
    padding: '16@s',
    alignItems: 'center',
  },
  loadingContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16@s',
  },
  errorText: {
    ...fontFamily.REPLAY_PRO.BOLD,
    fontSize: '16@s',
    color: colors.darkGray,
  },
  scrollView: {
    flex: 1,
  },
  webViewContainer: {
    marginBottom: ms(16),
  },
  webView: {
    width: SCREEN_WIDTH - ms(50),
    height: SCREEN_WIDTH - ms(50),
    borderRadius: ms(8),
  },
  loadingText: {
    ...typography.body,
    color: colors.darkSlate,
    marginTop: ms(16),
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: '24@s',
  },
  tabMargin: {
    alignSelf: 'stretch',
    marginHorizontal: '24@ms',
    marginVertical: '16@ms',
  },
});

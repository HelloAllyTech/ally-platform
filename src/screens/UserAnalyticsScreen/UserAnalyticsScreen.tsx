import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {t} from 'i18next';
import {ActivityIndicator, ScrollView, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';
import WebView from 'react-native-webview';

import {TabView} from '@/components';
import {AnalyticsType} from '@/constants/analytics';
import {isIOS, SCREEN_WIDTH} from '@/constants/general';
import {
  useGetDashboardsQuery,
  useLazyGetDashboardUrlQuery,
} from '@/services/analyticsApi';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

export const UserAnalyticsScreen: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AnalyticsType>(
    AnalyticsType.CALL_LOG_ANALYTICS,
  );

  const [getDashboardUrl] = useLazyGetDashboardUrlQuery();
  const {
    data: dashboards,
    isLoading: isLoadingDashboards,
    error,
  } = useGetDashboardsQuery();

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
            {t('Analytics.failedToLoadAnalytics')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Show tabs only if both analytics types are present */}
      <View style={styles.titleContainer}>
        <Text style={styles.title}>
          {t('Analytics.header.title')}{' '}
          <Text style={styles.boldItalic}>
            {t('Analytics.header.subtitle')}
          </Text>
        </Text>
      </View>
      {presentTypes.has(AnalyticsType.CALL_LOG_ANALYTICS) &&
        presentTypes.has(AnalyticsType.SIMULATION_ANALYTICS) && (
          <TabView<AnalyticsType>
            tabs={[
              {
                key: AnalyticsType.CALL_LOG_ANALYTICS,
                label: t('Analytics.sessionAnalytics'),
              },
              {
                key: AnalyticsType.SIMULATION_ANALYTICS,
                label: t('Analytics.simulationAnalytics'),
              },
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        )}

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
              <View key={dashboard.externalId} style={styles.webViewContainer}>
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
  titleContainer: {
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray7,
    marginTop: '16@s',
    paddingBottom: '16@s',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@s',
    color: colors.darkSlate,
    marginLeft: '16@s',
    textAlign: 'left',
  },
  boldItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
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
});

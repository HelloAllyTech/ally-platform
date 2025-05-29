import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {SCREEN_WIDTH} from '@/constants/general';
import {
  useGetDashboardsQuery,
  useLazyGetDashboardUrlQuery,
} from '@/services/analyticsApi';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

export const UserAnalyticsScreen: React.FC = () => {
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

  const handleDashboardPress = async (url: string) => {
    await Linking.openURL(url);
  };

  if (isLoadingDashboards) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Analytics</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.azureBlue} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Analytics</Text>
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load analytics</Text>
          <ActivityIndicator size="large" color={colors.darkGray} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Analytics</Text>
      </View>
      <View style={styles.content}>
        {Object.keys(dashboardUrls)?.map(id => (
          <TouchableOpacity
            onPress={() => handleDashboardPress(dashboardUrls[id])}
            key={id}
            style={styles.dashboardContainer}>
            <Text style={styles.dashboardLink}>Open Dashboard</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.white,
  },
  title: {
    ...fontFamily.REPLAY_PRO.BOLD,
    fontSize: 18,
    color: colors.darkSlate,
  },
  content: {
    flex: 1,
    padding: 16,
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
    gap: 16,
  },
  errorText: {
    ...typography.body,
    color: colors.darkGray,
  },
  dashboardContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.lightGray8,
    borderRadius: 8,
    justifyContent: 'center',
    marginBottom: 12,
    width: SCREEN_WIDTH - 50,
    height: 80,
    gap: 12,
  },
  dashboardText: {
    ...typography.body,
    color: colors.darkSlate,
  },
  dashboardLink: {
    fontSize: 16,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray,
  },
});

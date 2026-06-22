import {useCallback, useMemo, useState} from 'react';
import {ActivityIndicator, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';
import {TabBar, TabView} from 'react-native-tab-view';
import {useSelector} from 'react-redux';

import {BadgePopup, TabScreenHeader} from '@/components';
import {REVIEW_TYPE_TABS, ReviewType, USER_PERMISSIONS} from '@/constants';
import {useTranslate} from '@/hooks';
import {isReviewerOnly} from '@/navigation/TabNavigator';
import {useLazyGetReviewsQuery} from '@/services/reviewsApi';
import {useLazyGetScribeReviewsQuery} from '@/services/scribeReviewsApi';
import {AppRootState} from '@/store/store';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {ReviewList} from './components';

export const ReviewScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const layout = useWindowDimensions();

  const permissions = useSelector(
    (state: AppRootState) => state.user.permissions,
  );

  const canViewSimulationReviews = permissions.includes(
    USER_PERMISSIONS.VIEW_SIMULATION_REVIEWS,
  );
  const canViewScribeReviews = permissions.includes(
    USER_PERMISSIONS.VIEW_SCRIBE_REVIEWS,
  );

  const canViewSimulationReview = permissions.includes(
    USER_PERMISSIONS.VIEW_SIMULATION_REVIEW,
  );
  const canViewScribeReview = permissions.includes(
    USER_PERMISSIONS.VIEW_SCRIBE_REVIEW,
  );

  const reviewTypeTabs = useMemo(() => {
    const permissionMap: Record<string, boolean> = {
      [ReviewType.SIMULATION]: canViewSimulationReviews,
      [ReviewType.SCRIBE]: canViewScribeReviews,
    };

    return REVIEW_TYPE_TABS.filter(tab => permissionMap[tab.key] ?? false).map(
      tab => ({key: tab.key, title: t(tab.titleKey)}),
    );
  }, [canViewSimulationReviews, canViewScribeReviews, t]);

  const [activeType, setActiveType] = useState<ReviewType>(
    reviewTypeTabs[0]?.key ?? ReviewType.SIMULATION,
  );

  const showTypeTabs = reviewTypeTabs.length > 1;

  const tabIndex = useMemo(() => {
    const idx = reviewTypeTabs.findIndex(tab => tab.key === activeType);
    return idx >= 0 ? idx : 0;
  }, [reviewTypeTabs, activeType]);

  const handleTabChange = useCallback(
    (index: number) => {
      setActiveType(reviewTypeTabs[index].key);
    },
    [reviewTypeTabs],
  );

  const renderTabBar = useCallback(
    (props: Parameters<typeof TabBar>[0]) => (
      <TabBar
        {...props}
        pressColor="transparent"
        indicatorStyle={styles.tabBarIndicator}
        style={styles.tabBar}
        tabStyle={styles.tabBarTab}
        activeColor={colors.ds.theme.primary}
        inactiveColor={colors.ds.typography.lowEmphasis}
      />
    ),
    [],
  );

  const renderScene = useCallback(
    ({route: sceneRoute}: {route: {key: string}}) => {
      switch (sceneRoute.key) {
        case ReviewType.SIMULATION:
          return (
            <ReviewList
              reviewType="simulation"
              useLazyQuery={useLazyGetReviewsQuery}
              canViewReview={canViewSimulationReview}
            />
          );
        case ReviewType.SCRIBE:
          return (
            <ReviewList
              reviewType="scribe"
              useLazyQuery={useLazyGetScribeReviewsQuery}
              canViewReview={canViewScribeReview}
            />
          );
        default:
          return null;
      }
    },
    [canViewScribeReview, canViewSimulationReview],
  );

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <TabScreenHeader title={t('review.title')} />
      <View style={styles.contentContainer}>
        {showTypeTabs ? (
          <TabView
            navigationState={{
              index: tabIndex,
              routes: reviewTypeTabs,
            }}
            renderTabBar={renderTabBar}
            renderScene={renderScene}
            onIndexChange={handleTabChange}
            initialLayout={{width: layout.width}}
            lazy
            renderLazyPlaceholder={() => (
              <View style={styles.lazyPlaceholder}>
                <ActivityIndicator
                  size="large"
                  color={colors.ds.theme.primary}
                />
              </View>
            )}
            commonOptions={{labelStyle: styles.tabBarLabel}}
          />
        ) : (
          <ReviewList
            reviewType={reviewTypeTabs[0]?.key ?? ReviewType.SIMULATION}
            useLazyQuery={
              reviewTypeTabs[0]?.key === ReviewType.SCRIBE
                ? useLazyGetScribeReviewsQuery
                : useLazyGetReviewsQuery
            }
            canViewReview={
              reviewTypeTabs[0]?.key === ReviewType.SCRIBE
                ? canViewScribeReview
                : canViewSimulationReview
            }
          />
        )}
      </View>
      {isReviewerOnly(permissions) && <BadgePopup />}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  contentContainer: {
    flex: 1,
    backgroundColor: colors.lightGray9,
  },
  tabBarIndicator: {
    backgroundColor: colors.ds.theme.primary,
    height: 2,
  },
  tabBar: {
    backgroundColor: colors.ds.neutral.white,
    padding: '4@ms',
  },
  tabBarLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    textAlign: 'center',
    fontWeight: fontWeights.regular,
  },
  tabBarTab: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
    alignItems: 'center',
  },
  lazyPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

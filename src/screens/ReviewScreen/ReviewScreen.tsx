import {ActivityIndicator, FlatList, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyState, TabView, useToast} from '@/components';
import {useTranslate} from '@/hooks';
import {useReviews} from '@/hooks/useReviews';
import {ReviewCard} from '@/screens/ReviewScreen/components/ReviewCard';
import {ReviewFilter} from '@/services/reviewsApi';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

const filters = [
  {
    key: ReviewFilter.ALL,
    label: 'All',
  },
  {
    key: ReviewFilter.LATEST,
    label: 'Latest',
  },
  {
    key: ReviewFilter.MOST_REVIEWED,
    label: 'Most Reviewed',
  },
  {
    key: ReviewFilter.UNDISCOVERED,
    label: 'Undiscovered',
  },
];

export const SeparatorComponent = () => {
  return <View style={styles.itemSeparator} />;
};

export const ReviewScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const {showToast} = useToast();

  const {
    reviews,
    isLoading,
    isFetching,
    error,
    hasMore,
    selectedFilter,
    loadMore,
    refresh,
    setSelectedFilter,
  } = useReviews();

  if (error) {
    showToast(t('Review.fetchError'), 'error');
  }

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.titleContainer}>
        <Text style={styles.title}>{t('Review.header.title')} </Text>
      </View>

      <FlatList
        contentContainerStyle={styles.list}
        data={reviews}
        renderItem={({item}) => (
          <ReviewCard
            key={item.id}
            id={item.id}
            user={item.createdBy}
            scenario={item.scenario}
            commentsCount={item.commentsCount}
            reactions={item.reactions}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshing={isFetching}
        onRefresh={refresh}
        ListEmptyComponent={
          !isLoading && !isFetching && reviews.length === 0 ? (
            <EmptyState
              title={t('Review.empty.title')}
              description={t('Review.empty.description')}
            />
          ) : null
        }
        ListFooterComponent={
          isLoading || isFetching || hasMore ? (
            <View style={styles.footerContainer}>
              <ActivityIndicator size="small" color={colors.ds.theme.primary} />
            </View>
          ) : null
        }
        ListHeaderComponent={
          <TabView
            tabs={filters}
            tabWidthMode="content"
            activeTab={selectedFilter}
            onTabChange={setSelectedFilter}
          />
        }
        ItemSeparatorComponent={SeparatorComponent}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  titleContainer: {
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray7,
    marginTop: '16@s',
    paddingVertical: '8@s',
    paddingHorizontal: '24@s',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.ds.typography.highEmphasis,
    ...typography.display.small,
    fontWeight: fontWeights.medium,
  },
  list: {
    backgroundColor: colors.lightGray9,
    paddingHorizontal: '16@s',
    paddingTop: '10@ms',
    paddingBottom: '360@ms',
    gap: '10@ms',
  },

  itemSeparator: {
    height: '8@s',
  },
  tabMargin: {
    marginVertical: '16@ms',
  },
  emptyText: {
    ...fontFamily.REPLAY_PRO.BOLD,
    color: colors.ds.typography.lowEmphasis,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
  },
  footerContainer: {
    paddingVertical: '16@s',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

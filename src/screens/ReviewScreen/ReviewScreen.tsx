import {useCallback, useEffect, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, FlatList, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyReviewIcon} from '@/assets';
import {EmptyState, TabView, useToast} from '@/components';
import {REVIEW_FILTERS, SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useTranslate} from '@/hooks';
import {useReviews} from '@/hooks/useReviews';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {ReviewCard} from './components';

export const SeparatorComponent = () => {
  return <View style={styles.itemSeparator} />;
};

export const ReviewScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const {showToast} = useToast();
  const navigation = useAppNavigation();
  const isFirstFocus = useRef(true);

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

  // State for expanded cards
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);

  // Refresh reviews when screen comes into focus (skip initial mount)
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      refresh();
    }, [refresh]),
  );

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      showToast(t('Review.fetchError'), 'error');
    }
  }, [error, showToast, t]);

  const handleReviewPress = (reviewId: string) => {
    navigation.navigate(SCREEN_NAMES.REVIEW_DETAILS, {reviewId});
  };

  const handleCommentPress = (reviewId: string) => {
    setExpandedReviewId(prevId => (prevId === reviewId ? null : reviewId));
  };

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.titleContainer}>
        <Text style={styles.title}>{t('Review.header.title')} </Text>
      </View>
      <View style={styles.tabContainer}>
        <TabView
          tabs={REVIEW_FILTERS}
          tabWidthMode="content"
          activeTab={selectedFilter}
          onTabChange={setSelectedFilter}
        />
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
            onReviewPress={() => handleReviewPress(item.id)}
            onCommentPress={handleCommentPress}
            reactions={item.reactions}
            isExpanded={expandedReviewId === item.id}
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
              icon={EmptyReviewIcon}
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
    ...typography.display.small,
    fontWeight: fontWeights.light,
    color: colors.ds.typography.highEmphasis,
  },
  tabContainer: {
    marginTop: '16@ms',
    paddingHorizontal: '16@s',
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

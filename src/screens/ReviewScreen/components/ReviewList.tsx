import {useCallback, useEffect, useRef} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, FlatList, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyReviewIcon} from '@/assets';
import {EmptyState, TabView, useToast} from '@/components';
import {REVIEW_FILTERS, SCREEN_NAMES} from '@/constants';
import {ReviewType} from '@/contexts/ReviewApiContext';
import {useAppNavigation, useTranslate} from '@/hooks';
import {useReviews} from '@/hooks/useReviews';
import {
  useLazyGetGeneralReviewCommentsQuery,
  useLazyGetReviewsQuery,
} from '@/services/reviewsApi';
import {useLazyGetScribeGeneralReviewCommentsQuery} from '@/services/scribeReviewsApi';
import {colors} from '@/theme';

import {ReviewCard} from './ReviewCard';

type LazyReviewsQuery = typeof useLazyGetReviewsQuery;

interface ReviewListProps {
  reviewType: ReviewType;
  useLazyQuery: LazyReviewsQuery;
  canViewReview: boolean;
}

const SeparatorComponent = () => <View style={styles.itemSeparator} />;

export const ReviewList: React.FC<ReviewListProps> = ({
  reviewType,
  useLazyQuery,
  canViewReview,
}) => {
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
  } = useReviews(useLazyQuery);

  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (error) {
      showToast(t('Review.fetchError'), 'error');
    }
  }, [error, showToast, t]);

  const isScribe = reviewType === 'scribe';

  const screenName = isScribe
    ? SCREEN_NAMES.SCRIBE_REVIEW_DETAILS
    : SCREEN_NAMES.REVIEW_DETAILS;

  const lazyGeneralCommentsQuery = isScribe
    ? useLazyGetScribeGeneralReviewCommentsQuery
    : useLazyGetGeneralReviewCommentsQuery;

  const handleReviewPress = useCallback(
    (reviewId: string) => {
      navigation.navigate(screenName, {reviewId});
    },
    [navigation, screenName],
  );

  return (
    <>
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
        keyExtractor={item => item.id}
        renderItem={({item}) => (
          <ReviewCard
            id={item.id}
            user={item.createdBy}
            scenario={item.scenario}
            createdAt={item.createdAt}
            scenarioSession={item.scenarioSession}
            scribeSession={item.scribeSession}
            commentsCount={item.commentsCount}
            onReviewPress={
              canViewReview ? () => handleReviewPress(item.id) : undefined
            }
            reactions={item.reactions}
            note={item.note}
            reviewType={reviewType}
            useLazyGeneralCommentsQuery={lazyGeneralCommentsQuery}
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
    </>
  );
};

const styles = ScaledSheet.create({
  tabContainer: {
    marginTop: '16@ms',
    paddingHorizontal: '16@s',
  },
  list: {
    paddingHorizontal: '16@s',
    paddingTop: '10@ms',
    paddingBottom: '360@ms',
    gap: '10@ms',
  },
  itemSeparator: {
    height: '8@s',
  },
  footerContainer: {
    paddingVertical: '16@s',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

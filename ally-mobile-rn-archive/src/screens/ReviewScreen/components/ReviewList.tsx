import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, FlatList, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyReviewIcon} from '@/assets';
import {CustomDropdown, EmptyState, TabView, useToast} from '@/components';
import {READ_FILTER_OPTIONS, SCREEN_NAMES, SORT_OPTIONS} from '@/constants';
import {ReviewType} from '@/contexts/ReviewApiContext';
import {useAppNavigation, useTranslate} from '@/hooks';
import {useReviews} from '@/hooks/useReviews';
import {useLazyGetGeneralCommentsOverviewQuery} from '@/services/generalCommentsApi';
import {useLazyGetReviewsQuery} from '@/services/reviewsApi';
import {useLazyGetScribeGeneralCommentsOverviewQuery} from '@/services/scribeGeneralCommentsApi';
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
  const [isSortOpen, setIsSortOpen] = useState(false);

  const {
    reviews,
    isLoading,
    isFetching,
    error,
    hasMore,
    selectedReadFilter,
    selectedSort,
    loadMore,
    refresh,
    setSelectedReadFilter,
    setSelectedSort,
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
      showToast(t('review.error.title'), 'error');
    }
  }, [error, showToast, t]);

  const readFilterTabs = useMemo(
    () =>
      READ_FILTER_OPTIONS.map(filter => ({
        key: filter.key,
        label: t(filter.labelKey),
      })),
    [t],
  );

  const sortOptionLabels = useMemo(
    () => SORT_OPTIONS.map(o => t(o.labelKey)),
    [t],
  );

  const selectedSortLabel = useMemo(
    () =>
      t(
        SORT_OPTIONS.find(o => o.key === selectedSort)?.labelKey ??
          SORT_OPTIONS[0].labelKey,
      ),
    [selectedSort, t],
  );

  const isScribe = reviewType === 'scribe';

  const screenName = isScribe
    ? SCREEN_NAMES.SCRIBE_REVIEW_DETAILS
    : SCREEN_NAMES.REVIEW_DETAILS;

  const lazyGeneralCommentsQuery = isScribe
    ? useLazyGetScribeGeneralCommentsOverviewQuery
    : useLazyGetGeneralCommentsOverviewQuery;

  const handleReviewPress = useCallback(
    (reviewId: string) => {
      navigation.navigate(screenName, {reviewId});
    },
    [navigation, screenName],
  );

  const handleSortSelect = useCallback(
    (label: string) => {
      const option = SORT_OPTIONS.find(o => t(o.labelKey) === label);
      if (option) {
        setSelectedSort(option.key);
      }
      setIsSortOpen(false);
    },
    [setSelectedSort, t],
  );

  return (
    <>
      <View style={styles.controlsContainer}>
        <View style={styles.tabContainer}>
          <TabView
            tabs={readFilterTabs}
            tabWidthMode="content"
            activeTab={selectedReadFilter}
            onTabChange={setSelectedReadFilter}
          />
        </View>
        <View style={styles.sortContainer}>
          <CustomDropdown
            value={selectedSortLabel}
            options={sortOptionLabels}
            onSelect={handleSortSelect}
            isOpen={isSortOpen}
            setIsOpen={setIsSortOpen}
            alignModalRight
          />
        </View>
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
            summaryName={item.summaryName}
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
              title={t('review.empty.title')}
              description={t('review.empty.description')}
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
  controlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '16@ms',
    paddingHorizontal: '16@s',
  },
  tabContainer: {
    flex: 1,
  },
  sortContainer: {
    marginLeft: '8@s',
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

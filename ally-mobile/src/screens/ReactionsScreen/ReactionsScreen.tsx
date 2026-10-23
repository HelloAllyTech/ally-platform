import React, {useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets';
import {
  ReviewApiProvider,
  scribeApiHooks,
  simulationApiHooks,
} from '@/contexts/ReviewApiContext';
import {useAppNavigation} from '@/hooks';
import {useReactions} from '@/hooks/useReactions';
import {RootStackScreenProps} from '@/navigation';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {ReactionFilterTabs, ReactionListItem} from './components';
import {ReactionData} from './types';

type Props = RootStackScreenProps<'Reactions'>;

export const ReactionsScreen: React.FC<Props> = ({route}) => {
  const {reviewId, reviewType} = route.params;
  const apiHooks =
    reviewType === 'scribe' ? scribeApiHooks : simulationApiHooks;

  return (
    <ReviewApiProvider value={apiHooks}>
      <ReactionsContent reviewId={reviewId} />
    </ReviewApiProvider>
  );
};

const ReactionsContent: React.FC<{reviewId: string | number}> = ({
  reviewId,
}) => {
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();

  const {
    reactions,
    selectedReaction,
    summary,
    totalCount,
    isLoading,
    isFetching,
    handleReactionFilter,
    loadMore,
  } = useReactions(reviewId);

  const handleBackPress = () => {
    navigation.goBack();
  };

  const renderReactionItem = useCallback(
    ({item}: {item: ReactionData}) => <ReactionListItem item={item} />,
    [],
  );

  const renderFooter = useCallback(() => {
    if (!isFetching) return null;

    const bottomPadding = insets.bottom + ms(120);

    return (
      <View style={[styles.footerSpacer, {paddingBottom: bottomPadding}]}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  }, [isFetching, insets.bottom]);

  const renderEmptyComponent = useCallback(() => {
    if (isLoading || isFetching) {
      return null;
    }

    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {t('review.reactionsModal.noReactionsYet')}
        </Text>
      </View>
    );
  }, [isLoading, isFetching, t]);

  const handleLoadMore = useCallback(() => {
    loadMore();
  }, [loadMore]);

  const keyExtractor = useCallback(
    (item: ReactionData, index: number) =>
      `${item.createdBy.id}-${item.reaction}-${index}`,
    [],
  );

  return (
    <SafeAreaView
      style={[
        styles.sheetContainer,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.fixedHeader}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
            <LeftArrowIcon color={colors.black} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('review.reactionsModal.title')}</Text>
        </View>
        <ReactionFilterTabs
          summary={summary}
          selectedReaction={selectedReaction}
          totalCount={totalCount}
          onFilterChange={handleReactionFilter}
        />
      </View>

      {reviewId && (
        <FlatList
          data={reactions}
          keyExtractor={keyExtractor}
          renderItem={renderReactionItem}
          contentContainerStyle={[
            styles.listContent,
            reactions.length === 0 &&
              !isLoading &&
              !isFetching &&
              styles.listContentEmpty,
          ]}
          style={styles.list}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          removeClippedSubviews={false}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmptyComponent}
          showsVerticalScrollIndicator
        />
      )}
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  sheetContainer: {
    flex: 1,
    backgroundColor: colors.white,
  },
  backButton: {
    marginRight: '16@ms',
  },
  fixedHeader: {
    backgroundColor: colors.white,
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '10@ms',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
  list: {
    flex: 1,
    backgroundColor: colors.white,
  },
  listContent: {
    paddingBottom: '12@ms',
    minHeight: '100@ms',
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  footerSpacer: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: '24@ms',
  },
  emptyContainer: {
    paddingVertical: '40@ms',
    alignItems: 'center',
  },
  emptyText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.lowEmphasis,
  },
});

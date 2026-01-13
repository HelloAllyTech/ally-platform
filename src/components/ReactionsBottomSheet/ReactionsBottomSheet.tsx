import React, {useCallback, useRef} from 'react';
import {BottomSheetFlatList} from '@gorhom/bottom-sheet';
import {useTranslation} from 'react-i18next';
import {ActivityIndicator, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {BottomSheet} from '@/components/BottomSheet';
import {useReactions} from '@/hooks/useReactions';
import {useReactionsMock} from '@/hooks/useReactions.mock';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {ReactionFilterTabs} from './ReactionFilterTabs';
import {ReactionListItem} from './ReactionListItem';
import {ReactionData, ReactionsBottomSheetProps} from './types';

const USE_MOCK_DATA = __DEV__;

export const ReactionsBottomSheet: React.FC<ReactionsBottomSheetProps> = ({
  visible,
  onClose,
  reviewId,
}) => {
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();
  const listRef = useRef<React.ComponentRef<typeof BottomSheetFlatList>>(null);

  const useReactionsHook = USE_MOCK_DATA ? useReactionsMock : useReactions;
  const {
    reactions,
    selectedReaction,
    summary,
    totalCount,
    isLoading,
    isFetching,
    handleReactionFilter,
    loadMore,
  } = useReactionsHook(reviewId);

  const renderReactionItem = useCallback(
    ({item}: {item: ReactionData}) => <ReactionListItem item={item} />,
    [],
  );

  const renderFooter = useCallback(() => {
    const bottomPadding = insets.bottom + ms(120);

    return (
      <View style={[styles.footerSpacer, {paddingBottom: bottomPadding}]}>
        <ActivityIndicator
          size="small"
          color={colors.ds.theme.primary}
          style={{opacity: isFetching ? 1 : 0}}
        />
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
          {t('ReactionsBottomSheet.noReactionsYet')}
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

  const shouldShow = visible && !!reviewId;

  return (
    <BottomSheet
      visible={shouldShow}
      onClose={onClose}
      initialSnapPoint={60}
      allowFullExpand
      skipBottomSheetView
      enableContentPanningGesture={false}
      enableDynamicSizing={false}
      enableOverDrag={false}
      overDragResistanceFactor={0}
      enableHandlePanningGesture>
      <View style={styles.sheetContainer}>
        <View style={styles.fixedHeader}>
          <Text style={styles.title}>{t('ReactionsBottomSheet.title')}</Text>

          <ReactionFilterTabs
            summary={summary}
            selectedReaction={selectedReaction}
            totalCount={totalCount}
            onFilterChange={handleReactionFilter}
          />
        </View>

        {reviewId && (
          <BottomSheetFlatList
            ref={listRef}
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
      </View>
    </BottomSheet>
  );
};

const styles = ScaledSheet.create({
  sheetContainer: {
    flex: 1,
    backgroundColor: colors.white,
  },
  fixedHeader: {
    backgroundColor: colors.white,
    zIndex: 10,
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.headline.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
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

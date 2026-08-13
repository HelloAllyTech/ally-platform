import {useCallback, useState} from 'react';
import {ActivityIndicator, FlatList, RefreshControl, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {DataUnavailableIcon} from '@/assets';
import {
  EmptyState,
  LearningPathHeader,
  LearningPathListHeader,
} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {useHardwareBackPressHandler, useTranslate} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {
  useEnrollTrackMutation,
  useGetLearnTrackDetailQuery,
  useLazyGetNextTrackItemQuery,
} from '@/services';
import {colors} from '@/theme';
import {TrackDetailItem, TrackItemStatus, TrackSection} from '@/types';
import {findNextItemId, navigateToLearnTab} from '@/utils';

import {CourseSectionBlock} from './components/CourseSectionBlock';

export const CourseOverviewScreen: React.FC<
  RootStackScreenProps<typeof SCREEN_NAMES.COURSE_OVERVIEW>
> = ({navigation, route}) => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const {trackId} = route.params;

  const {
    data: track,
    isLoading,
    error,
    refetch,
  } = useGetLearnTrackDetailQuery({trackId}, {skip: !trackId});

  const [enrollTrack] = useEnrollTrackMutation();
  const [getNextItem] = useLazyGetNextTrackItemQuery();
  const [isStarting, setIsStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigateToLearnTab(navigation);
  };

  useHardwareBackPressHandler(() => {
    handleBack();
    return true;
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const nextItemId = findNextItemId(track);

  const handleItemPress = (item: TrackDetailItem) => {
    if (item.status === TrackItemStatus.LOCKED) return;
    navigation.navigate(SCREEN_NAMES.COURSE_ITEM_PLAYER, {
      trackId,
      itemId: item.id,
    });
  };

  const handleStartOrContinue = async () => {
    if (!track || isStarting) return;
    setIsStarting(true);
    try {
      if (!track.enrolled) {
        await enrollTrack({trackId}).unwrap();
      }
      const nextResult = await getNextItem({trackId}).unwrap();
      if (nextResult.trackCompleted || !nextResult.nextItem) {
        return;
      }
      navigation.navigate(SCREEN_NAMES.COURSE_ITEM_PLAYER, {
        trackId,
        itemId: nextResult.nextItem.id,
      });
    } catch {
      // Swallow — the learner stays on the overview and can retry.
    } finally {
      setIsStarting(false);
    }
  };

  const isCompleted =
    Boolean(track?.completedAt) ||
    (track?.totalItems ? track.completedItems >= track.totalItems : false);
  const sortedSections = [...(track?.sections ?? [])].sort(
    (a, b) => a.order - b.order,
  );

  const renderListHeaderComponent = () => {
    if (!track) return null;
    return (
      <LearningPathListHeader
        title={track.title}
        description={track.description ?? undefined}
        coverImageUrl={track.coverImageUrl ?? undefined}
        completedScenarios={track.completedItems}
        totalScenarios={track.totalItems}
        isCompleted={isCompleted}
        startButtonLabel={
          !track.enrolled || track.completedItems === 0
            ? t('common.start')
            : t('common.continue')
        }
        onStartPress={handleStartOrContinue}
        isStartDisabled={isStarting}
        isCreatingSession={isStarting}
      />
    );
  };

  const renderSection = ({
    item: section,
    index,
  }: {
    item: TrackSection;
    index: number;
  }) => (
    <CourseSectionBlock
      section={section}
      sectionIndex={index}
      nextItemId={nextItemId}
      onItemPress={handleItemPress}
    />
  );

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <LearningPathHeader
        title={t('learn.choose.course')}
        onBackPress={handleBack}
      />
      {isLoading ? (
        <ActivityIndicator
          size="large"
          color={colors.ds.theme.primary}
          style={styles.loadingContainer}
          testID="activity-indicator"
        />
      ) : error || !track ? (
        <EmptyState icon={DataUnavailableIcon} title={t('courses.notFound')} />
      ) : (
        <FlatList
          data={sortedSections}
          keyExtractor={section => section.id}
          renderItem={renderSection}
          ListHeaderComponent={renderListHeaderComponent}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  scrollContent: {
    paddingHorizontal: '21@ms',
    paddingBottom: '32@ms',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

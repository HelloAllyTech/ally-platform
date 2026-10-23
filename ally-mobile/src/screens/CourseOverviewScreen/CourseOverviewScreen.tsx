import {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {DataUnavailableIcon} from '@/assets';
import {
  EmptyState,
  LearningPathHeader,
  LearningPathListHeader,
} from '@/components';
import {getLabelFromCode} from '@/components/LanguageSelectorSheet';
import {SCREEN_NAMES} from '@/constants';
import {useHardwareBackPressHandler, useTranslate} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {
  useEnrollTrackMutation,
  useGetLearnTrackDetailQuery,
  useLazyGetNextTrackItemQuery,
} from '@/services';
import {colors, fontFamily, typography} from '@/theme';
import {
  TrackDetailItem,
  TrackItemStatus,
  TrackRoleplaySessionFeedback,
  TrackSection,
} from '@/types';
import {findNextItemId, navigateToLearnTab} from '@/utils';

import {CourseLanguageSheet} from './components/CourseLanguageSheet';
import {CourseProgressSheet} from './components/CourseProgressSheet';
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
  const [isLanguageSheetVisible, setIsLanguageSheetVisible] = useState(false);
  const [isProgressSheetVisible, setIsProgressSheetVisible] = useState(false);

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

  /**
   * Language row. Shown only when the course is actually published in more than
   * one language — a single-language course should not carry a control whose
   * only option is the one already selected.
   */
  const renderLanguageRow = () => {
    const options = track?.availableLanguages ?? [];
    if (options.length < 2) return null;
    const current = options.find(
      option => option.languageCode === track?.languageCode,
    );
    const label = current?.isSource
      ? current.label
      : (getLabelFromCode(track?.languageCode ?? 'en') ??
        current?.label ??
        'English');

    return (
      <View style={styles.languageRow}>
        <Text style={styles.languageRowText}>
          {t('courses.language.readingIn', {language: label})}
        </Text>
        <TouchableOpacity
          onPress={() => setIsLanguageSheetVisible(true)}
          accessibilityRole="button"
          testID="course-language-change">
          <Text style={styles.languageRowAction}>
            {t('courses.language.change')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

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
        onProgressPress={
          track.enrolled ? () => setIsProgressSheetVisible(true) : undefined
        }
      />
    );
  };

  const handleSessionPress = (session: TrackRoleplaySessionFeedback) => {
    setIsProgressSheetVisible(false);
    navigation.navigate(SCREEN_NAMES.SIMULATION_FEEDBACK, {
      scenarioSessionId: session.scenarioSessionId,
    });
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
        // 403 = the course exists but is not assigned to this learner's
        // organisation or group — typically someone opening a shared course
        // link. Say so, rather than claim the course does not exist.
        error && 'status' in error && error.status === 403 ? (
          <EmptyState
            icon={DataUnavailableIcon}
            title={t('courses.notAvailable.title')}
            description={t('courses.notAvailable.body')}
          />
        ) : (
          <EmptyState
            icon={DataUnavailableIcon}
            title={t('courses.notFound')}
          />
        )
      ) : (
        <FlatList
          data={sortedSections}
          ListHeaderComponentStyle={styles.listHeader}
          keyExtractor={section => section.id}
          renderItem={renderSection}
          ListHeaderComponent={
            <>
              {renderLanguageRow()}
              {renderListHeaderComponent()}
            </>
          }
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
      {!!track && (
        <CourseLanguageSheet
          visible={isLanguageSheetVisible}
          onClose={() => setIsLanguageSheetVisible(false)}
          trackId={trackId}
          options={track.availableLanguages ?? []}
          currentLanguageCode={track.languageCode ?? 'en'}
        />
      )}
      <CourseProgressSheet
        visible={isProgressSheetVisible}
        onClose={() => setIsProgressSheetVisible(false)}
        trackId={trackId}
        onSessionPress={handleSessionPress}
        onContinuePress={() => {
          setIsProgressSheetVisible(false);
          handleStartOrContinue();
        }}
      />
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
  listHeader: {
    paddingTop: '4@mvs',
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: '10@mvs',
  },
  languageRowText: {
    ...typography.body.small,
    ...fontFamily.ROBOTO.REGULAR,
    color: colors.ds.typography.mediumEmphasis,
  },
  languageRowAction: {
    ...typography.body.small,
    ...fontFamily.ROBOTO.REGULAR,
    color: colors.ds.theme.primary,
  },
});

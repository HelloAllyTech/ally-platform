import {useCallback, useEffect, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {Button, DiscussionThread} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {useTrackPlayerNavigation, useTranslate} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {
  useGetLearnTrackDetailQuery,
  useStartTrackItemMutation,
} from '@/services';
import {colors} from '@/theme';
import {
  StartTrackItemResponse,
  TrackGameKey,
  TrackItemCompletionResult,
  TrackItemStatus,
  TrackItemType,
} from '@/types';
import {
  clearActiveTrackContext,
  getActiveTrackContext,
  navigateToLearnTab,
} from '@/utils';

import {CelebrationKind, CelebrationModal} from './components/CelebrationModal';
import {PlayerBottomNav} from './components/PlayerBottomNav';
import {ArticlePlayer} from './components/players/ArticlePlayer';
import {GamePlayer} from './components/players/GamePlayer';
import {JournalPlayer} from './components/players/JournalPlayer';
import {NativeGamePlayer} from './components/players/NativeGamePlayer';
import {QuizItemPlayer} from './components/players/quiz/QuizItemPlayer';
import {RoleplayCasePlayer} from './components/players/RoleplayCasePlayer';
import {VideoItemPlayer} from './components/players/VideoItemPlayer';
import {PlayerTopBar} from './components/PlayerTopBar';
import {UnsupportedItemCard} from './components/UnsupportedItemCard';

export const CourseItemPlayerScreen: React.FC<
  RootStackScreenProps<typeof SCREEN_NAMES.COURSE_ITEM_PLAYER>
> = ({navigation, route}) => {
  const {t} = useTranslate();
  const {trackId, itemId, highlightPostId} = route.params;

  const {
    data: track,
    isLoading: isTrackLoading,
    isFetching: isTrackFetching,
    isError: isTrackError,
    refetch: refetchTrack,
  } = useGetLearnTrackDetailQuery({trackId});
  const [startTrackItem] = useStartTrackItemMutation();

  // Items completed in this player session (drives Next gating optimistically).
  const [justCompleted, setJustCompleted] = useState<Set<string>>(new Set());
  const [celebration, setCelebration] = useState<CelebrationKind | null>(null);

  const nav = useTrackPlayerNavigation(track, itemId, justCompleted);

  // Roleplay/case items complete out-of-band via the simulation/case
  // subsystem — on regaining focus (e.g. returning from a launched
  // roleplay), check whether we left a pending context for this track and,
  // if so, refetch so the item's real COMPLETED status comes back.
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      getActiveTrackContext().then(ctx => {
        if (isActive && ctx?.trackId === trackId) {
          clearActiveTrackContext();
          refetchTrack();
        }
      });
      return () => {
        isActive = false;
      };
    }, [trackId, refetchTrack]),
  );

  const [payload, setPayload] = useState<StartTrackItemResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isLoadingItem, setIsLoadingItem] = useState(false);

  const loadItem = useCallback(async () => {
    if (!nav.currentItemId) return;
    setIsLoadingItem(true);
    setLoadError(false);
    setPayload(null);
    try {
      const data = await startTrackItem({itemId: nav.currentItemId}).unwrap();
      setPayload(data);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoadingItem(false);
    }
  }, [nav.currentItemId, startTrackItem]);

  useEffect(() => {
    loadItem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.currentItemId]);

  const handleBackToOverview = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate(SCREEN_NAMES.COURSE_OVERVIEW, {trackId});
  }, [navigation, trackId]);

  const handleCompletion = useCallback(
    (result: TrackItemCompletionResult) => {
      if (!result.completed) return;
      setJustCompleted(prev => new Set(prev).add(nav.currentItemId));
      if (result.trackCompleted) {
        setCelebration('track');
      } else if (result.sectionCompleted) {
        setCelebration('section');
      }
    },
    [nav.currentItemId],
  );

  const goNextOrOverview = useCallback(() => {
    if (nav.hasNext) nav.goNext();
    else handleBackToOverview();
  }, [nav, handleBackToOverview]);

  const sectionItems = nav.current
    ? nav.flat.filter(f => f.sectionId === nav.current?.sectionId)
    : [];

  const alreadyCompleted =
    nav.current?.item.status === TrackItemStatus.COMPLETED ||
    justCompleted.has(nav.currentItemId);

  const completedCount = nav.flat.filter(
    f =>
      f.item.status === TrackItemStatus.COMPLETED ||
      justCompleted.has(f.item.id),
  ).length;

  // No cached track to fall back on: either the very first fetch is still
  // in flight, or a retry after a failure is (isTrackFetching with no
  // `track` yet). A background refetch that already has cached track data
  // (e.g. the on-focus refetch after a roleplay) should NOT re-trigger this
  // — the screen keeps rendering the cached track while it updates.
  const isTrackLoadPending = isTrackLoading || (isTrackFetching && !track);

  const renderItem = () => {
    // The track itself (sections/items/progress) failed to load — nothing
    // below this can resolve without it (nav.current stays undefined
    // forever), so surface this before the per-item states and give the
    // learner a way out instead of a permanent spinner.
    if (isTrackError && !isTrackLoadPending) {
      return (
        <View style={styles.centeredContent}>
          <Text style={styles.errorText}>
            {t('courses.player.trackLoadFailed')}
          </Text>
          <Button label={t('courses.player.retry')} onPress={refetchTrack} />
        </View>
      );
    }
    if (loadError) {
      return (
        <View style={styles.centeredContent}>
          <Text style={styles.errorText}>{t('courses.player.loadFailed')}</Text>
          <Button label={t('courses.player.retry')} onPress={loadItem} />
        </View>
      );
    }
    if (isTrackLoadPending || isLoadingItem || !payload || !nav.current) {
      return (
        <View style={styles.centeredContent}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }

    switch (payload.type) {
      case TrackItemType.ARTICLE:
        return (
          <ArticlePlayer
            payload={payload}
            itemId={nav.currentItemId}
            alreadyCompleted={alreadyCompleted}
            onCompleted={handleCompletion}
          />
        );
      case TrackItemType.VIDEO:
        return (
          <VideoItemPlayer
            payload={payload}
            itemId={nav.currentItemId}
            trackId={trackId}
            alreadyCompleted={alreadyCompleted}
          />
        );
      case TrackItemType.JOURNAL:
        return (
          <JournalPlayer
            payload={payload}
            itemId={nav.currentItemId}
            alreadyCompleted={alreadyCompleted}
            onCompleted={handleCompletion}
          />
        );
      case TrackItemType.QUIZ:
        return (
          <QuizItemPlayer
            payload={payload}
            itemId={nav.currentItemId}
            onCompleted={handleCompletion}
            onRequestNext={goNextOrOverview}
          />
        );
      case TrackItemType.GAME:
        if (payload.gameKey === TrackGameKey.BREATHING_EXERCISE) {
          return (
            <NativeGamePlayer
              payload={payload}
              itemId={nav.currentItemId}
              trackId={trackId}
              onCompleted={handleCompletion}
            />
          );
        }
        return (
          <GamePlayer
            payload={payload}
            itemId={nav.currentItemId}
            onCompleted={handleCompletion}
          />
        );
      case TrackItemType.ROLEPLAY:
      case TrackItemType.CASE:
        return (
          <RoleplayCasePlayer
            payload={payload}
            item={nav.current.item}
            trackId={trackId}
            alreadyCompleted={alreadyCompleted}
          />
        );
      default:
        // The web builder can ship a component type before this binary has a
        // player for it; say so rather than rendering an empty screen.
        return <UnsupportedItemCard onBackToCourse={handleBackToOverview} />;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <PlayerTopBar
        sectionTitle={nav.current?.sectionTitle ?? ''}
        itemTitle={nav.current?.item.title ?? ''}
        itemDescription={nav.current?.item.description ?? null}
        sectionItems={sectionItems}
        currentItemId={nav.currentItemId}
        overallPct={nav.overallPct}
        onExit={handleBackToOverview}
      />

      <View style={styles.body}>{renderItem()}</View>

      {nav.current?.item.hasDiscussion ? (
        <DiscussionThread
          itemId={nav.currentItemId}
          highlightPostId={highlightPostId}
        />
      ) : null}

      <PlayerBottomNav
        hasPrev={nav.hasPrev}
        hasNext={nav.hasNext}
        canAdvance={nav.canAdvance}
        onPrev={nav.goPrev}
        onNext={goNextOrOverview}
        isLastItem={!nav.hasNext}
      />

      <CelebrationModal
        kind={celebration}
        completedCount={completedCount}
        onContinue={() => {
          setCelebration(null);
          goNextOrOverview();
        }}
        onBackToLearn={() => {
          setCelebration(null);
          navigateToLearnTab(navigation);
        }}
      />
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  body: {
    flex: 1,
  },
  centeredContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12@ms',
    paddingHorizontal: '24@ms',
  },
  errorText: {
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  placeholderText: {
    color: colors.ds.typography.highEmphasis,
    fontSize: '18@ms',
  },
  placeholderSubtext: {
    color: colors.ds.typography.mediumEmphasis,
  },
});

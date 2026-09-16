import React from 'react';
import {ActivityIndicator, ScrollView, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {DataUnavailableIcon} from '@/assets';
import {EmptyState, LearningPathHeader} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {useHardwareBackPressHandler, useTranslate} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {
  useGetLearnTrackProgressQuery,
  useLazyGetNextTrackItemQuery,
} from '@/services';
import {colors} from '@/theme';
import {TrackRoleplaySessionFeedback} from '@/types';

import {CourseProgressBody} from './components/CourseProgressBody';

/**
 * A learner's progress-and-feedback screen for one course: percent complete
 * plus consolidated skill feedback across every roleplay session evaluated so
 * far. Complements CourseOverviewScreen ("what's next") rather than replacing
 * it — this screen answers "what have I shown so far".
 */
export const CourseProgressScreen: React.FC<
  RootStackScreenProps<typeof SCREEN_NAMES.COURSE_PROGRESS>
> = ({navigation, route}) => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const {trackId} = route.params;

  const {
    data: dashboard,
    isLoading,
    error,
  } = useGetLearnTrackProgressQuery({trackId}, {skip: !trackId});
  const [getNextItem] = useLazyGetNextTrackItemQuery();

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  useHardwareBackPressHandler(() => {
    handleBack();
    return true;
  });

  const handleSessionPress = (session: TrackRoleplaySessionFeedback) => {
    navigation.navigate(SCREEN_NAMES.SIMULATION_FEEDBACK, {
      scenarioSessionId: session.scenarioSessionId,
    });
  };

  // Reaching this screen at all means the learner is enrolled (the endpoint
  // 403s otherwise), so — unlike CourseOverviewScreen's Start/Continue —
  // there is no enroll branch here.
  const handleContinuePress = async () => {
    try {
      const nextResult = await getNextItem({trackId}).unwrap();
      if (nextResult.trackCompleted || !nextResult.nextItem) return;
      navigation.navigate(SCREEN_NAMES.COURSE_ITEM_PLAYER, {
        trackId,
        itemId: nextResult.nextItem.id,
      });
    } catch {
      // Swallow — the learner stays on the dashboard and can retry.
    }
  };

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <LearningPathHeader
        title={t('courses.progressDashboard.title')}
        onBackPress={handleBack}
      />
      {isLoading ? (
        <ActivityIndicator
          size="large"
          color={colors.ds.theme.primary}
          style={styles.loadingContainer}
          testID="activity-indicator"
        />
      ) : error || !dashboard ? (
        <EmptyState
          icon={DataUnavailableIcon}
          title={t('courses.progressDashboard.notFound')}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <CourseProgressBody
            dashboard={dashboard}
            onSessionPress={handleSessionPress}
            onContinuePress={() => handleContinuePress()}
          />
        </ScrollView>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: '21@ms',
    paddingBottom: '32@ms',
  },
});

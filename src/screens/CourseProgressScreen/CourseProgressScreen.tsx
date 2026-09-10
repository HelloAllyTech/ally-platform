import React from 'react';
import {ActivityIndicator, ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {DataUnavailableIcon} from '@/assets';
import {EmptyState, LearningPathHeader, ProgressBar} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {useHardwareBackPressHandler, useTranslate} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {useGetLearnTrackProgressQuery} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {TrackRoleplaySessionFeedback} from '@/types';

import {RoleplaySessionRow} from './components/RoleplaySessionRow';
import {SectionProgressRow} from './components/SectionProgressRow';
import {SkillCategoryRow} from './components/SkillCategoryRow';

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

  const sortedSections = [...(dashboard?.sections ?? [])].sort(
    (a, b) => a.order - b.order,
  );

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
          <ProgressBar
            current={dashboard.completedItems}
            total={dashboard.totalItems}
          />

          {sortedSections.length > 0 && (
            <View style={styles.sectionList}>
              {sortedSections.map(section => (
                <SectionProgressRow key={section.id} section={section} />
              ))}
            </View>
          )}

          <View style={styles.block}>
            <Text style={styles.heading}>
              {t('courses.progressDashboard.feedbackHeading')}
            </Text>
            {dashboard.evaluatedRoleplaySessionCount > 0 && (
              <Text style={styles.subheading}>
                {t('courses.progressDashboard.feedbackSubheading', {
                  count: dashboard.evaluatedRoleplaySessionCount,
                })}
              </Text>
            )}

            {dashboard.skillCategories.length === 0 ? (
              <View style={styles.emptyFeedback}>
                <Text style={styles.emptyFeedbackText}>
                  {t('courses.progressDashboard.feedbackEmpty')}
                </Text>
              </View>
            ) : (
              <View style={styles.skillList}>
                {dashboard.skillCategories.map(skill => (
                  <SkillCategoryRow key={skill.category} skill={skill} />
                ))}
              </View>
            )}
          </View>

          {dashboard.roleplaySessions.length > 0 && (
            <View style={styles.block}>
              <Text style={styles.heading}>
                {t('courses.progressDashboard.sessionsHeading')}
              </Text>
              <View style={styles.sessionList}>
                {[...dashboard.roleplaySessions].reverse().map(session => (
                  <RoleplaySessionRow
                    key={`${session.trackItemId}-${session.scenarioSessionId}`}
                    session={session}
                    onPress={handleSessionPress}
                  />
                ))}
              </View>
            </View>
          )}
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
  sectionList: {
    marginTop: '16@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    paddingHorizontal: '12@ms',
  },
  block: {
    marginTop: '24@ms',
  },
  heading: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '4@ms',
  },
  subheading: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
    marginBottom: '12@ms',
  },
  emptyFeedback: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '20@ms',
    alignItems: 'center',
  },
  emptyFeedbackText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  skillList: {
    gap: '10@ms',
  },
  sessionList: {
    gap: '8@ms',
  },
});

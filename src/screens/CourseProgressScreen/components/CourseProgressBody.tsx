import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ProgressBar} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {TrackProgressDashboard, TrackRoleplaySessionFeedback} from '@/types';

import {LatestFeedbackPreview} from './LatestFeedbackPreview';
import {PracticeNudge} from './PracticeNudge';
import {RoleplaySessionRow} from './RoleplaySessionRow';
import {ScoreTrendSparkline} from './ScoreTrendSparkline';
import {SectionProgressRow} from './SectionProgressRow';
import {SkillCategoryRow} from './SkillCategoryRow';

interface CourseProgressBodyProps {
  dashboard: TrackProgressDashboard;
  onSessionPress: (session: TrackRoleplaySessionFeedback) => void;
  /** Continues the learner into the next unlocked item in this course. */
  onContinuePress: () => void;
}

/**
 * The dashboard's actual content — overall progress, per-section rollup,
 * consolidated feedback, and the practice-sessions list — with no fetch/
 * loading/error handling and no screen chrome of its own. Shared between the
 * standalone CourseProgressScreen and the in-context bottom sheet opened from
 * CourseOverviewScreen's progress bar, which each frame it differently.
 */
export const CourseProgressBody: React.FC<CourseProgressBodyProps> = ({
  dashboard,
  onSessionPress,
  onContinuePress,
}) => {
  const {t} = useTranslate();
  const sortedSections = [...dashboard.sections].sort(
    (a, b) => a.order - b.order,
  );
  const latestSession =
    dashboard.roleplaySessions[dashboard.roleplaySessions.length - 1];

  return (
    <>
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

      <PracticeNudge
        skillCategories={dashboard.skillCategories}
        onContinuePress={onContinuePress}
      />

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

        <View style={styles.sparklineContainer}>
          <ScoreTrendSparkline sessions={dashboard.roleplaySessions} />
        </View>

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

        {latestSession && (
          <View style={styles.latestFeedback}>
            <LatestFeedbackPreview
              session={latestSession}
              onPress={onSessionPress}
            />
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
                onPress={onSessionPress}
              />
            ))}
          </View>
        </View>
      )}
    </>
  );
};

const styles = ScaledSheet.create({
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
  sparklineContainer: {
    marginBottom: '12@ms',
  },
  skillList: {
    gap: '10@ms',
  },
  latestFeedback: {
    marginTop: '12@ms',
  },
  sessionList: {
    gap: '8@ms',
  },
});

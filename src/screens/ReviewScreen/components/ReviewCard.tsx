import {useEffect} from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {useTranslation} from 'react-i18next';
import {Text, TouchableOpacity, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {ChatAddOnIcon} from '@/assets';
import {SimulationDetailsCard, UserProfileImage} from '@/components';
import {SimulationDetailRow} from '@/components/SimulationDetailsCard/SimulationDetailRow';
import {useLazyGetGeneralReviewCommentsQuery} from '@/services/reviewsApi';
import {
  colors,
  fontFamily,
  fontWeights,
  radius,
  stroke,
  theme,
  typography,
} from '@/theme';
import {ReviewScenario, ScenarioSessionData, User} from '@/types/reviews';
import {
  formatDateTime,
  formatDurationFromSeconds,
  formatRelativeTime,
  pluralize,
} from '@/utils';

import {ExpandedComments} from './ExpandedComments';
import {ReactionsCount} from './ReactionsCount';

dayjs.extend(relativeTime);

interface ReviewCardProps {
  id: string;
  user: User;
  scenario: ReviewScenario;
  createdAt: string;
  scenarioSession: ScenarioSessionData;
  commentsCount?: number;
  reactions?: {
    [reaction_code: string]: number;
  };
  onReviewPress: (reviewId?: string) => void;
  onCommentPress?: (reviewId: string) => void;
  isExpanded?: boolean;
  note?: string;
}

const ReviewCard: React.FC<ReviewCardProps> = ({
  id,
  user,
  scenario,
  createdAt,
  scenarioSession,
  commentsCount = 0,
  reactions = {},
  onReviewPress,
  onCommentPress,
  isExpanded = false,
  note,
}) => {
  const {t} = useTranslation();

  const [
    getGeneralComments,
    {data: generalCommentsData, isLoading: isLoadingGeneral},
  ] = useLazyGetGeneralReviewCommentsQuery();

  useEffect(() => {
    if (isExpanded && !generalCommentsData) {
      getGeneralComments({reviewId: id, offset: 0, limit: 2});
    }
  }, [isExpanded, id, getGeneralComments, generalCommentsData]);

  const totalReactions = Object.values(reactions).reduce(
    (sum, count) => sum + count,
    0,
  );

  const handleReviewItemPress = () => {
    onReviewPress?.(id);
  };

  const renderUserInfo = () => (
    <View style={styles.userInfoContainer}>
      <UserProfileImage
        {...(user.profileImage
          ? {
              profileImageUri: user?.profileImage,
              size: ms(36),
            }
          : {
              name: user?.name,
              size: ms(36),
              textSize: 'large',
            })}
      />
      <View>
        <Text style={styles.userName}>{user.name}</Text>
        <Text style={styles.timeAgoText}>{formatRelativeTime(createdAt)}</Text>
      </View>
    </View>
  );

  const renderSimulationCard = () => (
    <SimulationDetailsCard
      coverImageUrl={scenario.coverImageUrl}
      coverVideoUrl={scenario.coverVideoUrl}
      title={scenario.title}
      description={scenario.description}
    />
  );

  const renderReactionsAndComments = () => (
    <View style={styles.reactionCommentContainer}>
      <ReactionsCount
        reviewId={id}
        reactions={reactions}
        totalReactions={totalReactions}
      />
      <TouchableOpacity
        style={styles.commentCountContainer}
        onPress={() => onCommentPress?.(id)}>
        <Text style={styles.commentText}>
          {pluralize(commentsCount, t('Review.card.comment'))}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.reviewItem}>
      {renderUserInfo()}

      <View style={styles.separator} />

      <View>
        {/* <Text style={styles.simulationDetailsHeading}>
          {t('Review.card.sharedSimulationForReview')}
        </Text> */}
        {note && <Text style={styles.noteText}>{note}</Text>}
        <SimulationDetailRow
          label={t('Review.card.dateAndTime')}
          value={formatDateTime(scenarioSession.createdAt)}
        />
        {scenarioSession.duration !== undefined && (
          <SimulationDetailRow
            label={t('Review.card.duration')}
            value={formatDurationFromSeconds(scenarioSession.duration)}
          />
        )}
      </View>
      {renderSimulationCard()}

      <TouchableOpacity
        style={styles.reviewTranscriptContainer}
        onPress={handleReviewItemPress}>
        <ChatAddOnIcon width={16} height={16} />
        <Text style={styles.reviewTranscriptText}>
          {t('Review.card.reviewTranscript')}
        </Text>
      </TouchableOpacity>

      <View style={styles.separator} />

      {renderReactionsAndComments()}

      <ExpandedComments
        isExpanded={isExpanded}
        isLoading={isLoadingGeneral}
        generalCommentsData={generalCommentsData}
        reviewId={id}
        onCollapsePress={() => onCommentPress?.(id)}
        onCommentPress={onReviewPress}
        t={t}
      />
    </View>
  );
};

export {ReviewCard};

const styles = ScaledSheet.create({
  reviewItem: {
    borderRadius: radius.xl2,
    borderColor: stroke.primary,
    borderWidth: 0.5,
    backgroundColor: colors.white,
    padding: '16@s',
    gap: '16@s',
  },
  userInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@s',
  },
  userImage: {
    width: '36@s',
    height: '36@s',
    borderRadius: radius.full,
  },
  userImageContainer: {
    width: '36@s',
    height: '36@s',
    borderRadius: radius.full,
    backgroundColor: colors.lightGray7,
  },
  userName: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  timeAgoText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  separator: {
    height: '0.5@vs',
    backgroundColor: colors.ds.stroke.primary,
  },
  simulationDetailsHeading: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
  reviewTranscriptContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@s',
    alignSelf: 'center',
  },
  reviewTranscriptText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: theme.primary,
  },
  reactionCommentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16@s',
  },
  reactionCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@s',
  },
  reactionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  commentText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  commentCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '16@s',
  },
  reactionBubble: {
    padding: '4@s',
    borderRadius: radius.full,
    borderWidth: 0.5,
    borderColor: stroke.primary,
    backgroundColor: colors.white,
  },
  reactionBubbleOverlap: {
    marginRight: '-8@s',
  },
  emojisContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  noteText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '8@s',
  },
});

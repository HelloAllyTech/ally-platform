import {useCallback, useState} from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {useTranslation} from 'react-i18next';
import {Text, TouchableOpacity, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {ChatAddOnIcon} from '@/assets';
import {SimulationDetailsCard, UserProfileImage} from '@/components';
import {SimulationDetailRow} from '@/components/SimulationDetailsCard/SimulationDetailRow';
import {ReviewType} from '@/contexts/ReviewApiContext';
import {SimulationAudioPlayer} from '@/screens/SimulationFeedbackScreen/components/SimulationAudioPlayer/SimulationAudioPlayer';
import {useLazyGetGeneralCommentsOverviewQuery} from '@/services/generalCommentsApi';
import {
  colors,
  fontFamily,
  fontWeights,
  radius,
  stroke,
  theme,
  typography,
} from '@/theme';
import {
  ReviewScenario,
  ScenarioSessionData,
  ScribeSessionData,
  User,
} from '@/types/reviews';
import {
  formatDateTime,
  formatDurationFromSeconds,
  formatRelativeTime,
  htmlToPlainText,
  pluralize,
} from '@/utils';

import {ExpandedComments} from './ExpandedComments';
import {ReactionsCount} from './ReactionsCount';

dayjs.extend(relativeTime);

type LazyGeneralCommentsQuery = typeof useLazyGetGeneralCommentsOverviewQuery;

interface ReviewCardProps {
  id: string;
  user: User;
  scenario?: ReviewScenario;
  createdAt: string;
  scenarioSession?: ScenarioSessionData;
  scribeSession?: ScribeSessionData;
  commentsCount?: number;
  reactions?: {
    [reaction_code: string]: number;
  };
  onReviewPress?: (reviewId?: string) => void;
  note?: string;
  reviewType?: ReviewType;
  summaryName?: string;
  useLazyGeneralCommentsQuery?: LazyGeneralCommentsQuery;
}

const ReviewCard: React.FC<ReviewCardProps> = ({
  id,
  user,
  scenario,
  createdAt,
  scenarioSession,
  scribeSession,
  commentsCount = 0,
  reactions = {},
  onReviewPress,
  note,
  reviewType,
  useLazyGeneralCommentsQuery = useLazyGetGeneralCommentsOverviewQuery,
}) => {
  const {t} = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const isScribe = reviewType === 'scribe';
  const session = scenarioSession ?? scribeSession;
  const shouldShowAudioPlayer = !isScribe && !!scenarioSession?.audioUrl;

  const [
    getGeneralComments,
    {data: generalCommentsData, isLoading: isLoadingGeneral},
  ] = useLazyGeneralCommentsQuery();

  const handleCommentPress = useCallback(async () => {
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    if (commentsCount === 0) return;
    if (generalCommentsData !== undefined) {
      setIsExpanded(true);
      return;
    }
    await getGeneralComments({reviewId: id, offset: 0, limit: 2});
    setIsExpanded(true);
  }, [isExpanded, commentsCount, generalCommentsData, getGeneralComments, id]);

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

  const renderDetailRows = () => (
    <>
      {!!session?.createdAt && (
        <SimulationDetailRow
          label={t('review.details.dateAndTime')}
          value={formatDateTime(session.createdAt)}
        />
      )}
      {session?.duration !== undefined && (
        <SimulationDetailRow
          label={t('review.feedCard.duration')}
          value={formatDurationFromSeconds(session.duration)}
        />
      )}
    </>
  );

  const renderReactionsAndComments = () => (
    <View style={styles.reactionCommentContainer}>
      <ReactionsCount
        reviewId={id}
        reactions={reactions}
        totalReactions={totalReactions}
        reviewType={reviewType}
      />
      <TouchableOpacity
        style={styles.commentCountContainer}
        onPress={handleCommentPress}>
        <Text style={styles.commentText}>
          {pluralize(commentsCount, t('review.details.commentLabel'))}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderSimulationDetails = () => (
    <>
      <View>{renderDetailRows()}</View>
      {!!scenario && (
        <SimulationDetailsCard
          reviewType={reviewType}
          coverImageUrl={scenario.coverImageUrl}
          coverVideoUrl={scenario.coverVideoUrl}
          title={scenario.title}
          description={htmlToPlainText(scenario.description)}
        />
      )}
    </>
  );

  const renderScribeDetails = () => (
    <SimulationDetailsCard
      reviewType={reviewType}
      title={scribeSession?.summaryName}
      description={renderDetailRows()}
    />
  );

  return (
    <View style={styles.reviewItem}>
      {renderUserInfo()}

      <View style={styles.separator} />

      {!!note && <Text style={styles.noteText}>{note}</Text>}

      {isScribe ? renderScribeDetails() : renderSimulationDetails()}

      {shouldShowAudioPlayer && (
        <SimulationAudioPlayer
          audioUrl={scenarioSession!.audioUrl as string}
          onProgress={() => {}}
          containerStyle={styles.audioPlayer}
        />
      )}

      {onReviewPress && (
        <TouchableOpacity
          style={styles.reviewTranscriptContainer}
          onPress={handleReviewItemPress}>
          <ChatAddOnIcon width={16} height={16} />
          <Text style={styles.reviewTranscriptText}>
            {t('review.feedCard.reviewTranscript')}
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.separator} />

      {renderReactionsAndComments()}

      <ExpandedComments
        isExpanded={isExpanded}
        isLoading={isLoadingGeneral}
        generalCommentsData={generalCommentsData}
        reviewId={id}
        onCollapsePress={handleCommentPress}
        onCommentPress={onReviewPress ? () => onReviewPress(id) : undefined}
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
  audioPlayer: {
    marginHorizontal: 0,
    marginBottom: 0,
    paddingVertical: '8@ms',
  },
});

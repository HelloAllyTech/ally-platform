import {useEffect, useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {useTranslation} from 'react-i18next';
import {
  Image,
  NativeSyntheticEvent,
  Text,
  TextLayoutEventData,
  TouchableOpacity,
  View,
} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {ChatAddOnIcon, ProfileIcon} from '@/assets';
import {VideoPreview} from '@/components';
import {useLazyGetThreadsQuery} from '@/services/reviewThreadsApi';
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
  titleNumberOfLines?: number;
  descriptionNumberOfLines?: number;
  onReviewPress: (reviewId?: string) => void;
  onCommentPress?: (reviewId: string) => void;
  isExpanded?: boolean;
}

const ReviewCard: React.FC<ReviewCardProps> = ({
  id,
  user,
  scenario,
  createdAt,
  scenarioSession,
  commentsCount = 0,
  reactions = {},
  titleNumberOfLines = 1,
  descriptionNumberOfLines = 2,
  onReviewPress,
  onCommentPress,
  isExpanded = false,
}) => {
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isTextTruncated, setIsTextTruncated] = useState(false);
  const isFocused = useIsFocused();
  const {t} = useTranslation();

  // Fetch threads when expanded
  const [getThreads, {data: threadsData, isLoading: isLoadingThreads}] =
    useLazyGetThreadsQuery();

  useEffect(() => {
    if (isExpanded && !threadsData) {
      getThreads({reviewId: id, offset: 0, limit: 2});
    }
  }, [isExpanded, id, getThreads, threadsData]);

  const totalReactions = Object.values(reactions).reduce(
    (sum, count) => sum + count,
    0,
  );

  const handleReviewItemPress = () => {
    onReviewPress?.(id);
  };

  const toggleDescription = () => {
    setIsDescriptionExpanded(!isDescriptionExpanded);
  };

  const handleTextLayout = (
    event: NativeSyntheticEvent<TextLayoutEventData>,
  ) => {
    if (isDescriptionExpanded) return;
    const {lines} = event.nativeEvent;
    if (lines.length > descriptionNumberOfLines) {
      setIsTextTruncated(true);
    }
  };

  const renderDetailRow = (label: string, value: string) => (
    <View style={styles.simulationDetailsTextContainer}>
      <Text
        style={[styles.simulationDetailsText, styles.simulationDetailsLabel]}>
        {label}
      </Text>
      <Text
        style={[styles.simulationDetailsText, styles.simulationDetailsValue]}>
        {value}
      </Text>
    </View>
  );

  const renderUserInfo = () => (
    <View style={styles.userInfoContainer}>
      {/* <View style={styles.userImageContainer}> */}
      {user.profileImage ? (
        <Image source={{uri: user.profileImage}} style={styles.userImage} />
      ) : (
        <ProfileIcon
          width={ms(36)}
          height={ms(36)}
          color={colors.lightGray15}
        />
      )}
      {/* </View> */}
      <View>
        <Text style={styles.userName}>{user.name}</Text>
        <Text style={styles.timeAgoText}>{formatRelativeTime(createdAt)}</Text>
      </View>
    </View>
  );

  const renderSimulationCard = () => (
    <View style={styles.scenarioContainer}>
      <View style={styles.coverContainer}>
        {!!scenario.coverVideoUrl && (
          <VideoPreview
            videoUrl={scenario.coverVideoUrl}
            autoPlay={false}
            shouldPause={!isFocused}
            testID="scenario-video-preview"
          />
        )}

        {!scenario.coverVideoUrl && !!scenario.coverImageUrl && (
          <Image source={{uri: scenario.coverImageUrl}} style={styles.cover} />
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.textContainer}>
          <Text style={styles.cardTitle} numberOfLines={titleNumberOfLines}>
            {scenario.title || '-'}
          </Text>
          {!!scenario.description && (
            <View>
              <Text
                style={styles.cardDesc}
                numberOfLines={
                  isDescriptionExpanded ? undefined : descriptionNumberOfLines
                }
                onTextLayout={handleTextLayout}>
                {scenario.description}
              </Text>
              {(isTextTruncated || isDescriptionExpanded) && (
                <TouchableOpacity onPress={toggleDescription}>
                  <Text style={styles.viewMoreText}>
                    {isDescriptionExpanded
                      ? t('Review.card.viewLess')
                      : t('Review.card.viewMore')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
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
        <Text style={styles.simulationDetailsHeading}>
          {t('Review.card.sharedSimulationForReview')}
        </Text>
        {renderDetailRow(
          t('Review.card.dateAndTime'),
          formatDateTime(scenarioSession.createdAt),
        )}
        {scenarioSession.duration !== undefined &&
          renderDetailRow(
            t('Review.card.duration'),
            formatDurationFromSeconds(scenarioSession.duration),
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
        isLoading={isLoadingThreads}
        threadsData={threadsData}
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
  coverContainer: {
    width: '100%',
  },
  cover: {
    minHeight: '180@ms',
    backgroundColor: colors.ds.grey[100],
    borderRadius: radius.lg,
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
  },
  cardTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '5@ms',
  },
  cardDesc: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  viewMoreText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  separator: {
    height: '0.5@vs',
    backgroundColor: colors.ds.stroke.primary,
  },
  simulationDetailsTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  simulationDetailsHeading: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
  simulationDetailsText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  simulationDetailsLabel: {
    width: '100@s',
  },
  simulationDetailsValue: {
    flex: 1,
  },
  scenarioContainer: {
    borderWidth: 0.5,
    borderColor: stroke.primary,
    borderRadius: radius.xl2,
    padding: '8@s',
    gap: '16@s',
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
});

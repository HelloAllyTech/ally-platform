import {useState} from 'react';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {HelpIcon} from '@/assets';
import {CustomSwitch, ReviewTypeChip, UserProfileImage} from '@/components';
import {ReviewType} from '@/contexts/ReviewApiContext';
import {useTranslate} from '@/hooks';
import {SimulationDetailsModal} from '@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {User} from '@/types/reviews';
import {
  formatDateTime,
  formatDurationFromSeconds,
  htmlToPlainText,
} from '@/utils';

interface ScenarioDetails {
  title?: string;
  description?: string;
  coverImageUrl?: string;
  coverVideoUrl?: string;
}

interface ReviewTranscriptHeaderProps {
  reviewType: ReviewType;
  title: string;
  user: User;
  createdAt?: string;
  duration?: number | string;
  sessionDetails?: ScenarioDetails;
  isPrivate?: boolean;
  onTogglePrivate?: (isEnabled: boolean) => void;
}

export const ReviewTranscriptHeader = ({
  reviewType,
  title,
  user,
  createdAt,
  duration,
  sessionDetails,
  isPrivate = false,
  onTogglePrivate,
}: ReviewTranscriptHeaderProps) => {
  const [showSimulationDetailsModal, setShowSimulationDetailsModal] =
    useState<boolean>(false);
  const {t} = useTranslate();

  const renderSubtitleItem = (
    isSeparatorRequired: boolean,
    label: string,
    value?: string,
  ) => (
    <View style={styles.subtitleContainer}>
      {isSeparatorRequired && <Text style={styles.separator}>•</Text>}
      <Text style={styles.subtitle}>{label}</Text>
      {!!value && (
        <Text style={styles.subtitle}>
          {': '}
          {value}
        </Text>
      )}
    </View>
  );

  return (
    <>
      <View style={styles.container}>
        <View style={styles.titleRow}>
          <View style={styles.titleContainer}>
            <ReviewTypeChip reviewType={reviewType} />
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            {!!sessionDetails && (
              <TouchableOpacity
                onPress={() => setShowSimulationDetailsModal(true)}>
                <HelpIcon width={14} height={14} />
              </TouchableOpacity>
            )}
          </View>
          {onTogglePrivate && (
            <View style={styles.shareSwitchContainer}>
              <Text style={styles.shareSwitchLabel}>
                {t('learn.scenario.share')}
              </Text>
              <CustomSwitch
                value={!isPrivate}
                onToggle={onTogglePrivate}
                color={colors.ds.green[200]}
              />
            </View>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subtitleContainer}>
          <View style={styles.userContainer}>
            <UserProfileImage
              {...(user.profileImage
                ? {
                    profileImageUri: user?.profileImage,
                    size: ms(16),
                  }
                : {
                    name: user?.name,
                    size: ms(16),
                    textSize: 'micro',
                  })}
            />
          </View>
          {!!user?.name &&
            renderSubtitleItem(false, t('review.byAuthor', {name: user?.name}))}
          {!!createdAt && renderSubtitleItem(true, formatDateTime(createdAt))}
          {!!duration &&
            renderSubtitleItem(
              true,
              t('common.duration'),
              formatDurationFromSeconds(duration),
            )}
        </ScrollView>
      </View>
      {!!sessionDetails && (
        <SimulationDetailsModal
          visible={showSimulationDetailsModal}
          onClose={() => setShowSimulationDetailsModal(false)}
          title={t('simulationPage.simulationDetails')}
          description={htmlToPlainText(sessionDetails.description)}
          coverImageUrl={sessionDetails.coverImageUrl}
          coverVideoUrl={sessionDetails.coverVideoUrl}
          headerTitle={sessionDetails.title}
          fitContent
        />
      )}
    </>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingHorizontal: '8@s',
    gap: '4@s',
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    flexShrink: 1,
  },
  subtitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@s',
  },
  subtitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.mediumEmphasis,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
  },
  userContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@s',
  },
  separator: {
    marginHorizontal: '4@s',
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.mediumEmphasis,
    ...typography.body.medium,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@s',
    flexShrink: 1,
  },
  shareSwitchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  shareSwitchLabel: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.lowEmphasis,
  },
});

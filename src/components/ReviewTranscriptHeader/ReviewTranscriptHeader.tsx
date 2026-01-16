import {useState} from 'react';
import {Image, ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {HelpIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {SimulationDetailsModal} from '@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal';
import {colors, fontFamily, fontWeights, radius, typography} from '@/theme';
import {ReviewScenario, User} from '@/types/reviews';
import {formatDateTime, formatDurationFromSeconds} from '@/utils';

interface ReviewTranscriptHeaderProps {
  scenario?: ReviewScenario;
  user: User;
}
export const ReviewTranscriptHeader = ({
  scenario,
  user,
}: ReviewTranscriptHeaderProps) => {
  const [showSimulationDetailsModal, setShowSimulationDetailsModal] =
    useState<boolean>(false);
  const {t} = useTranslate();

  const {
    title,
    createdAt,
    duration,
    description,
    coverImageUrl,
    coverVideoUrl,
  } = scenario || {};

  const renderSubtitleItem = (
    isSeparatorRequired: boolean,
    label: string,
    value?: string,
  ) => (
    <View style={styles.subtitleContainer}>
      <Text style={styles.subtitle}>{label}</Text>
      {value && (
        <Text style={styles.subtitle}>
          {': '}
          {value}
        </Text>
      )}
      {isSeparatorRequired && <Text style={styles.separator}>•</Text>}
    </View>
  );

  return (
    <>
      <View style={styles.container}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity
            onPress={() => {
              setShowSimulationDetailsModal(true);
            }}>
            <HelpIcon width={14} height={14} />
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subtitleContainer}>
          <View style={styles.userContainer}>
            {user?.profileImage && (
              <Image
                source={{uri: user?.profileImage}}
                style={styles.userImage}
              />
            )}
          </View>
          {user?.name && renderSubtitleItem(true, user?.name)}
          {createdAt && renderSubtitleItem(true, formatDateTime(createdAt))}
          {duration &&
            renderSubtitleItem(
              false,
              t('Review.card.duration'),
              formatDurationFromSeconds(duration),
            )}
        </ScrollView>
      </View>
      <SimulationDetailsModal
        visible={showSimulationDetailsModal}
        onClose={() => setShowSimulationDetailsModal(false)}
        title={t('Review.card.simulationDetails')}
        description={description}
        coverImageUrl={coverImageUrl}
        coverVideoUrl={coverVideoUrl}
        headerTitle={title}
        fitContent
      />
    </>
  );
};

const styles = ScaledSheet.create({
  container: {
    gap: '8@s',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
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
  userImage: {
    width: '16@s',
    height: '16@s',
    borderRadius: radius.full,
    backgroundColor: colors.lightGray7,
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
  },
});

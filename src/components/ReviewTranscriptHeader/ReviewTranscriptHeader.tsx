import {useState} from 'react';
import {Image, ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {HelpIcon, ProfileIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {SimulationDetailsModal} from '@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal';
import {colors, fontFamily, fontWeights, radius, typography} from '@/theme';
import {ReviewScenario, ScenarioSessionData, User} from '@/types/reviews';
import {formatDateTime, formatDurationFromSeconds} from '@/utils';

interface ReviewTranscriptHeaderProps {
  scenario?: ReviewScenario;
  scenarioSession?: ScenarioSessionData;
  user: User;
}
export const ReviewTranscriptHeader = ({
  scenario,
  scenarioSession,
  user,
}: ReviewTranscriptHeaderProps) => {
  const [showSimulationDetailsModal, setShowSimulationDetailsModal] =
    useState<boolean>(false);
  const {t} = useTranslate();

  const {title, description, coverImageUrl, coverVideoUrl} = scenario || {};

  const renderSubtitleItem = (
    isSeparatorRequired: boolean,
    label: string,
    value?: string,
  ) => (
    <View style={styles.subtitleContainer}>
      {isSeparatorRequired && <Text style={styles.separator}>•</Text>}
      <Text style={styles.subtitle}>{label}</Text>
      {value && (
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
        <View style={styles.titleContainer}>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
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
            {user?.profileImage ? (
              <Image
                source={{uri: user?.profileImage}}
                style={styles.userImage}
              />
            ) : (
              <ProfileIcon
                width={ms(16)}
                height={ms(16)}
                color={colors.lightGray15}
              />
            )}
          </View>
          {user?.name && renderSubtitleItem(false, `By ${user?.name}`)}
          {scenarioSession?.createdAt &&
            renderSubtitleItem(
              true,
              formatDateTime(scenarioSession?.createdAt),
            )}
          {scenarioSession?.duration &&
            renderSubtitleItem(
              true,
              t('Review.card.duration'),
              formatDurationFromSeconds(scenarioSession?.duration),
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
    paddingHorizontal: '8@s',
    gap: '4@s',
    flex: 1,
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    maxWidth: '80%',
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

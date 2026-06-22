import React from 'react';
import {Image, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, radius, stroke, typography} from '@/theme';
import {UpNextSimulation} from '@/types';

interface UpNextSimulationCardProps {
  upNext: UpNextSimulation;
}

export const UpNextSimulationCard: React.FC<UpNextSimulationCardProps> = ({
  upNext,
}) => {
  const {t} = useTranslate();

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {upNext.coverImageUrl && (
          <Image
            source={{uri: upNext.coverImageUrl}}
            style={styles.thumbnail}
            resizeMode="contain"
          />
        )}
        <View style={styles.headerTextContainer}>
          <Text style={styles.upNextLabel}>
            {t('postSim.tabs.upNext')} - {t('common.simulation')} {upNext.order}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {upNext.title}
          </Text>
        </View>
      </View>
      <View style={styles.content}>
        <Text style={styles.scenarioLabel}>
          {t('learn.scenario.scenarioLabel')}:
        </Text>
        <Text style={styles.description}>{upNext.description}</Text>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: '0.5@ms',
    borderColor: stroke.primary,
    overflow: 'hidden',
  },
  content: {
    padding: '14@ms',
  },
  header: {
    flexDirection: 'row',
    gap: '16@ms',
    backgroundColor: colors.ds.grey[50],
    padding: '14@ms',
  },
  thumbnail: {
    aspectRatio: 16 / 9,
    borderRadius: '8@ms',
    backgroundColor: colors.ds.grey[200],
  },
  headerTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  upNextLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
    marginBottom: '4@vs',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '20@ms',
    lineHeight: '28@ms',
    color: colors.ds.typography.highEmphasis,
  },
  scenarioLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginBottom: '8@vs',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
});

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
            {t('SimulationFeedback.upNext')} - {t('Simulations.simulation')}{' '}
            {upNext.order}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {upNext.title}
          </Text>
        </View>
      </View>

      <Text style={styles.scenarioLabel}>{t('Simulations.scenario')}:</Text>
      <Text style={styles.description}>{upNext.description}</Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {},
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: '0.5@ms',
    borderColor: stroke.primary,
    padding: '14@ms',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    gap: '16@ms',
    marginBottom: '28@ms',
  },
  thumbnail: {
    width: '120@ms',
    height: '100%',
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

import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface ListeningTalkingStats {
  listeningPercent?: number;
  talkingPercent?: number;
}

interface Props {
  stats: ListeningTalkingStats;
}

export const ListeningTalkingDistribution: React.FC<Props> = ({stats}) => {
  const {t} = useTranslate();
  const {listeningPercent = 0, talkingPercent = 0} = stats;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {t('analytics.listeningTalking.title')}
      </Text>
      <View style={styles.barContainer}>
        {listeningPercent > 0 && (
          <View style={[styles.barListening, {flex: listeningPercent}]}>
            <Text style={styles.barText}>{listeningPercent}%</Text>
          </View>
        )}
        {talkingPercent > 0 && (
          <View style={[styles.barTalking, {flex: talkingPercent}]}>
            <Text style={styles.barTextDark}>{talkingPercent}%</Text>
          </View>
        )}
        {listeningPercent === 0 && talkingPercent === 0 && (
          <View style={styles.barNoData}>
            <Text style={styles.barNoDataText}>
              {t('analytics.listeningTalking.noData')}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, styles.legendColorListening]} />
          <Text style={styles.legendLabel}>
            {t('analytics.listeningTalking.listening')}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, styles.legendColorTalking]} />
          <Text style={styles.legendLabel}>
            {t('analytics.listeningTalking.talking')}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  card: {
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: '12@s',
    padding: '18@s',
    marginBottom: '18@s',
    borderWidth: 0.5,
    borderColor: colors.lightGray7,
  },
  cardTitle: {
    fontSize: '16@s',
    color: colors.darkSlate,
    fontFamily: fontFamily.REPLAY_PRO.BOLD.fontFamily,
    marginBottom: '20@s',
  },
  barContainer: {
    flexDirection: 'row',
    height: '36@s',
    borderRadius: '4@s',
    overflow: 'hidden',
    marginBottom: '16@s',
    marginTop: '4@s',
    backgroundColor: colors.lightGray,
  },
  barListening: {
    backgroundColor: colors.lightBlue3,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: '12@s',
  },
  barTalking: {
    backgroundColor: colors.lightBlue4,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: '12@s',
  },
  barText: {
    color: colors.black,
    fontSize: '16@ms',
    lineHeight: '32@mvs',
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
  },
  barTextDark: {
    color: colors.white,
    fontSize: '16@ms',
    lineHeight: '32@mvs',
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
  },
  legendRow: {
    flexDirection: 'row',
    gap: '18@s',
    marginTop: '2@s',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@s',
  },
  legendColor: {
    width: '18@s',
    height: '18@s',
    borderRadius: '4@s',
    marginRight: '2@s',
  },
  legendLabel: {
    fontSize: '12@s',
    color: colors.darkSlate,
    fontFamily: fontFamily.REPLAY_PRO.BOLD.fontFamily,
  },
  legendColorListening: {
    backgroundColor: colors.lightBlue3,
  },
  legendColorTalking: {
    backgroundColor: colors.lightBlue4,
  },
  barNoData: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  barNoDataText: {
    fontSize: '12@s',
    color: colors.gray,
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
  },
});

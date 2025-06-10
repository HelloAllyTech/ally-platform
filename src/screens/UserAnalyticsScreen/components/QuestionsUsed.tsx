import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

export const QuestionsUsed: React.FC = () => {
  const {t} = useTranslate();

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('analytics.questions.title')}</Text>
      <Text style={styles.questionsUsed}>
        <Text style={styles.questionsUsedNum}>{8}</Text>
        <Text style={styles.questionsUsedTotal}>/{10}</Text>
      </Text>
      <Text style={styles.questionsDesc}>
        {t('analytics.questions.description')}
      </Text>
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
  questionsUsed: {
    fontSize: '32@s',
    color: colors.darkSlate,
    marginBottom: '4@s',
    fontFamily: fontFamily.REPLAY_PRO.BOLD.fontFamily,
  },
  questionsUsedNum: {
    fontSize: '36@s',
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
  },
  questionsUsedTotal: {
    fontSize: '36@s',
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
  },
  questionsDesc: {
    fontSize: '14@s',
    color: colors.gray,
    marginTop: '6@s',
    lineHeight: '20@s',
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
  },
});

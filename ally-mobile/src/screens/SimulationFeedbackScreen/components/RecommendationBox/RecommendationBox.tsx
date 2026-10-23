import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

interface RecommendationBoxProps {
  recommendation: string;
}

export const RecommendationBox: React.FC<RecommendationBoxProps> = ({
  recommendation,
}) => {
  const {t} = useTranslate();

  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.label}>{t('postSim.skills.recommended')}</Text>
          <Text style={styles.recommendationText}>{recommendation}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  wrapper: {
    paddingLeft: '16@ms',
  },
  container: {
    backgroundColor: 'rgba(255, 243, 224, 0.5)',
    borderLeftWidth: 1,
    borderLeftColor: colors.ds.orange[400],
  },
  content: {
    padding: '16@ms',
    gap: '4@vs',
  },
  label: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '13@ms',
    lineHeight: '20@ms',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ds.orange[900],
  },
  recommendationText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '20@ms',
    letterSpacing: 0.25,
    color: colors.black,
  },
});

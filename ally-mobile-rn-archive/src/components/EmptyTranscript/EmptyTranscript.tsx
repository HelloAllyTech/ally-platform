import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyTranscriptIcon} from '@/assets/icons';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

export const EmptyTranscript: React.FC = () => {
  const {t} = useTranslate();
  return (
    <View style={styles.emptyContainer}>
      <EmptyTranscriptIcon />
      <Text style={styles.emptyText}>{t('transcription.empty')}</Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: '40%',
  },
  emptyText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray2,
    fontSize: '16@ms',
    lineHeight: '24@mvs',
    marginTop: '30@mvs',
    marginHorizontal: '30%',
    textAlign: 'center',
  },
});

import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {HourGlassIcon} from '@/assets/icons';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

export const ShortSessionUI: React.FC = () => {
  const {t} = useTranslate();

  return (
    <View style={styles.container}>
      <HourGlassIcon />
      <Text style={styles.title}>{t('postSim.shortSession.title')}</Text>
      <Text style={styles.description}>
        {t('postSim.shortSession.description')}
      </Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '24@ms',
    paddingBottom: '30@vs',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.headline.small,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
    marginTop: '20@vs',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
    marginTop: '8@vs',
  },
});

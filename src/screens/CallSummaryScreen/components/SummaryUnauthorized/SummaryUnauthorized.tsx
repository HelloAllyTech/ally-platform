import React from 'react';
import {Image, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {summaryFailed} from '@/assets';
import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

interface SummaryUnauthorizedProps {
  onGoBack: () => void;
}

export const SummaryUnauthorized: React.FC<SummaryUnauthorizedProps> = ({
  onGoBack,
}) => {
  const {t} = useTranslate();

  return (
    <View style={styles.container}>
      <Image source={summaryFailed} />
      <Text style={styles.title}>{t('summary.notFoundTitle')}</Text>
      <Text style={styles.subtitle}>{t('summary.notFoundDesc')}</Text>
      <Button
        label={t('achievements.backAria')}
        onPress={onGoBack}
        customContainerStyle={styles.button}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '24@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '24@ms',
    lineHeight: '32@mvs',
    color: colors.darkSlate,
    marginTop: '24@ms',
    textAlign: 'center',
  },
  subtitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    lineHeight: '24@mvs',
    color: colors.darkGray2,
    textAlign: 'center',
    marginTop: '8@ms',
    marginBottom: '24@ms',
  },
  button: {
    width: '70%',
  },
});

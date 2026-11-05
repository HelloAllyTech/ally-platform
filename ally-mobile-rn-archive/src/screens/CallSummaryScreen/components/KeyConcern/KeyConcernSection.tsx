import React, {useEffect, useState} from 'react';
import {TextInput, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily} from '@/theme';

interface KeyConcernSectionProps {
  concerns: string;
}

export const KeyConcernSection: React.FC<KeyConcernSectionProps> = ({
  concerns,
}) => {
  const {t} = useTranslate();
  const [concernsText, setConcernsText] = useState(concerns);

  useEffect(() => {
    setConcernsText(concerns);
  }, [concerns]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.editableText}
        value={concernsText}
        onChangeText={setConcernsText}
        placeholder={t('callSummary.addConcern')}
        numberOfLines={10}
        multiline
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingBottom: '6@ms',
  },
  editableText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.darkSlate,
    lineHeight: '26@ms',
  },
});

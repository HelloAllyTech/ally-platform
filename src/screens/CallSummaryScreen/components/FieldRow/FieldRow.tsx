import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

interface FieldRowProps {
  label: string;
  value: string | number;
  showSeparator?: boolean;
}

export const FieldRow: React.FC<FieldRowProps> = ({
  label,
  value,
  showSeparator = false,
}) => (
  <>
    <View style={styles.fieldContainer}>
      <Text style={styles.label}>{label}:</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
    {showSeparator && <View style={styles.separator} />}
  </>
);

const styles = ScaledSheet.create({
  fieldContainer: {
    flexDirection: 'row',
    marginBottom: '5@vs',
  },
  label: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.mediumGray2,
    marginRight: '8@ms',
  },
  value: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.lightGray3,
  },
  separator: {
    height: '1@vs',
    backgroundColor: colors.lightGray2,
    marginTop: '-3@vs',
    marginBottom: '8@vs',
  },
});

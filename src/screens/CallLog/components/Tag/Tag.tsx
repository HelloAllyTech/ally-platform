import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export const Tag = ({
  label,
  color,
  textColor,
}: {
  label: string;
  color: string;
  textColor: string;
}) => (
  <View style={[styles.tag, {backgroundColor: color}]}>
    <Text style={[styles.tagText, {color: textColor}]}>{label}</Text>
  </View>
);

const styles = ScaledSheet.create({
  tag: {
    borderRadius: '10@ms',
    height: '20@ms',
    paddingHorizontal: '8@ms',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: '2@ms',
    marginTop: '2@ms',
    marginBottom: '2@ms',
  },
  tagText: {
    fontSize: '10@ms',
    fontWeight: '400',
    color: colors.black,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
});

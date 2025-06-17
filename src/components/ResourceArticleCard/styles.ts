import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

export const getThemedStyles = (colorScheme: string | null) => {
  const isDark = colorScheme === 'dark';
  return ScaledSheet.create({
    card: {
      backgroundColor: isDark ? colors.darkGray5 : colors.white,
      borderRadius: '8@ms',
      borderWidth: 0.5,
      borderColor: isDark ? colors.darkGray5 : colors.lightGray14,
      paddingHorizontal: '10@s',
      paddingVertical: '10@vs',
      marginVertical: '6@vs',
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: '12@vs',
      justifyContent: 'space-between',
      overflow: 'hidden',
    },
    categoryChip: {
      backgroundColor: isDark ? colors.white3 : colors.white4,
      borderRadius: '16@ms',
      paddingHorizontal: '12@s',
      paddingVertical: '3@vs',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: '8@s',
      height: '24@ms',
    },
    categoryText: {
      ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
      color: isDark ? colors.darkGray5 : colors.darkGray14,
      fontSize: '12@ms',
      lineHeight: '16@ms',
    },
    tagChip: {
      backgroundColor: isDark ? colors.darkGray10 : colors.white,
      borderColor: isDark ? colors.darkGray10 : colors.lightGray14,
      borderWidth: 0.5,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: '16@ms',
      paddingHorizontal: '12@s',
      paddingVertical: '2@mvs',
      marginLeft: '8@s',
    },
    tagText: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      color: isDark ? colors.white2 : colors.darkGray15,
      fontSize: '12@ms',
      lineHeight: '20@mvs',
    },
    title: {
      ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
      fontSize: '16@ms',
      color: isDark ? colors.white : colors.black,
      lineHeight: '18@ms',
      marginBottom: '8@vs',
    },
    contentRow: {
      position: 'relative',
      marginBottom: '0@vs',
    },
    content: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      fontSize: '14@ms',
      color: isDark ? colors.white2 : colors.darkGray6,
      lineHeight: '18@ms',
    },
    moreButton: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      backgroundColor: isDark ? colors.darkGray5 : colors.white,
      paddingHorizontal: 0,
      paddingVertical: 0,
    },
    moreText: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      color: isDark ? colors.white2 : colors.darkGray6,
      fontSize: '14@ms',
      textDecorationLine: 'underline',
      lineHeight: '18@ms',
      marginRight: '50%',
    },
  });
};

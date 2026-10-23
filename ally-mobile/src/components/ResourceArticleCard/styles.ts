import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

const lightTheme = {
  cardBackground: colors.white,
  cardBorderColor: colors.lightGray14,
  categoryChipBackground: colors.white4,
  categoryTextColor: colors.darkGray14,
  tagChipBackground: colors.white,
  tagChipBorderColor: colors.lightGray14,
  tagTextColor: colors.darkGray15,
  titleColor: colors.black,
  contentColor: colors.darkGray6,
  moreButtonBackground: colors.white,
  moreTextColor: colors.darkGray6,
};

const darkTheme = {
  cardBackground: colors.darkGray5,
  cardBorderColor: colors.darkGray5,
  categoryChipBackground: colors.white3,
  categoryTextColor: colors.darkGray5,
  tagChipBackground: colors.darkGray10,
  tagChipBorderColor: colors.darkGray10,
  tagTextColor: colors.white2,
  titleColor: colors.white,
  contentColor: colors.white2,
  moreButtonBackground: colors.darkGray5,
  moreTextColor: colors.white2,
};

export const getThemedStyles = (colorScheme: string | null) => {
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;

  return ScaledSheet.create({
    card: {
      backgroundColor: theme.cardBackground,
      borderRadius: '8@ms',
      borderWidth: 0.5,
      borderColor: theme.cardBorderColor,
      paddingVertical: '10@vs',
      marginVertical: '6@vs',
    },
    paddingH10: {
      paddingHorizontal: '10@s',
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: '12@vs',
      justifyContent: 'space-between',
      overflow: 'hidden',
    },
    categoryChip: {
      backgroundColor: theme.categoryChipBackground,
      borderRadius: '16@ms',
      paddingHorizontal: '12@s',
      paddingVertical: '3@vs',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: '8@s',
      height: '24@ms',
      marginLeft: '10@s',
    },
    categoryText: {
      ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
      color: theme.categoryTextColor,
      fontSize: '12@ms',
      lineHeight: '16@ms',
    },
    tagChip: {
      backgroundColor: theme.tagChipBackground,
      borderColor: theme.tagChipBorderColor,
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
      color: theme.tagTextColor,
      fontSize: '12@ms',
      lineHeight: '20@mvs',
    },
    title: {
      ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
      fontSize: '16@ms',
      color: theme.titleColor,
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
      color: theme.contentColor,
      lineHeight: '18@ms',
    },
    moreButton: {
      backgroundColor: theme.moreButtonBackground,
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: '4@ms',
    },
    moreText: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      color: theme.moreTextColor,
      fontSize: '13@ms',
      lineHeight: '18@ms',
    },
  });
};

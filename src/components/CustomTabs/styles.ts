import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';
import type {ThemeMode} from '@/types';

const lightTheme = {
  background: colors.white,
  borderColor: colors.lightGray14,
  activeBorderColor: colors.black,
  textColor: colors.lightGray3,
  activeTextColor: colors.darkSlate,
};

const darkTheme = {
  background: colors.darkGray7,
  borderColor: colors.darkGray9,
  activeBorderColor: colors.white,
  textColor: colors.lightGray15,
  activeTextColor: colors.lightGray15,
};

export const getThemedStyles = (colorScheme: ThemeMode | null) => {
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;

  return ScaledSheet.create({
    container: {
      backgroundColor: theme.background,
    },
    tabHeader: {
      height: '38@ms',
      backgroundColor: theme.background,
      borderBottomWidth: 1,
      borderBottomColor: theme.borderColor,
    },
    tabHeaderContent: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 0,
      minHeight: '36@ms',
      backgroundColor: theme.background,
    },
    tabButton: {
      paddingHorizontal: '10@ms',
      paddingBottom: '3@ms',
      height: '36@ms',
      justifyContent: 'flex-end',
      alignItems: 'center',
      backgroundColor: theme.background,
    },
    activeTabButton: {
      borderBottomWidth: 2,
      marginBottom: '-2@ms',
      borderBottomColor: theme.activeBorderColor,
    },
    tabText: {
      ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
      ...typography.body.small,
      color: theme.textColor,
      textAlign: 'center',
      fontWeight: '400',
    },
    activeTabText: {
      color: theme.activeTextColor,
      fontWeight: '500',
    },
    tabBody: {
      backgroundColor: theme.background,
      marginTop: '6@ms',
    },
    tabBodyContent: {
      paddingBottom: '200@ms',
    },
    moreTab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: '8@ms',
    },
    moreIcon: {
      width: '10@ms',
      height: '5@ms',
      marginLeft: '4@ms',
    },
  });
};

import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';
import type {ThemeMode} from '@/types/general';

export const getThemedStyles = (colorScheme: ThemeMode | null) => {
  const isDark = colorScheme === 'dark';
  return ScaledSheet.create({
    container: {
      backgroundColor: isDark ? colors.darkGray7 : colors.white,
    },
    tabHeader: {
      height: '38@ms',
      backgroundColor: isDark ? colors.darkSlate : colors.white,
    },
    tabHeaderContent: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 0,
      minHeight: '36@ms',
    },
    tabButton: {
      paddingHorizontal: '10@ms',
      paddingBottom: '3@ms',
      height: '36@ms',
      justifyContent: 'flex-end',
      alignItems: 'center',
      borderBottomWidth: 0.7,
      borderBottomColor: isDark ? colors.darkGray9 : colors.lightGray14,
      backgroundColor: isDark ? colors.darkGray7 : colors.white,
    },
    activeTabButton: {
      borderBottomWidth: 2,
      borderBottomColor: isDark ? colors.white : colors.black,
    },
    tabText: {
      ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
      ...typography.body.small,
      color: isDark ? colors.lightGray15 : colors.lightGray3,
      textAlign: 'center',
      fontWeight: '400',
    },
    activeTabText: {
      color: isDark ? colors.lightGray15 : colors.darkSlate,
      fontWeight: '500',
    },
    tabBody: {
      backgroundColor: isDark ? colors.darkGray7 : colors.white,
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

export default getThemedStyles;

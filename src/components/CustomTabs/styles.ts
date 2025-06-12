import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

export const getThemedStyles = (colorScheme: string | null) => {
  const isDark = colorScheme === 'dark';
  return ScaledSheet.create({
    container: {
      backgroundColor: isDark ? colors.darkSlate : colors.white,
    },
    tabHeader: {
      height: '38@ms',
      borderBottomWidth: 0.5,
      borderBottomColor: colors.lightGray4,
      backgroundColor: isDark ? colors.darkSlate : colors.white,
    },
    tabHeaderContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: '12@ms',
      paddingHorizontal: 0,
      minHeight: '36@ms',
    },
    tabButton: {
      paddingHorizontal: '8@ms',
      paddingBottom: '3@ms',
      height: '36@ms',
      justifyContent: 'flex-end',
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      backgroundColor: 'transparent',
    },
    activeTabButton: {
      borderBottomColor: colors.black,
    },
    tabText: {
      ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
      ...typography.body.small,
      color: colors.lightGray3,
      textAlign: 'center',
      fontWeight: '400',
    },
    activeTabText: {
      color: colors.darkSlate,
      fontWeight: '500',
    },
    tabBody: {
      backgroundColor: isDark ? colors.darkSlate : colors.white,
      marginTop: '6@ms',
    },
    tabBodyContent: {
      paddingBottom: '16@ms',
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

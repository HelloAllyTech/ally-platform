import {moderateScale} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

export const calendarTheme = {
  calendarBackground: colors.white,
  textSectionTitleColor: colors.lightGray11,
  selectedDayBackgroundColor: colors.lightBlue5,
  selectedDayTextColor: colors.blue,
  todayTextColor: colors.blue,
  dayTextColor: colors.darkSlate,
  textDisabledColor: colors.lightGray4,
  arrowColor: colors.azureBlue,
  textDayFontFamily: fontFamily.ROBOTO.REGULAR.fontFamily,
  textDayFontSize: moderateScale(12),
  textDayFontWeight: '500',
  'stylesheet.calendar.header': {
    header: {display: 'none'}, // Hide default header
  },
  'stylesheet.day.basic': {
    base: {
      width: moderateScale(32),
      height: moderateScale(32),
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: moderateScale(16),
    },
  },
} as const;

export const localeConfig = {
  monthNames: [],
  monthNamesShort: [],
  dayNames: [],
  dayNamesShort: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  today: '',
};

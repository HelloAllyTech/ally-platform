jest.mock('react-native-size-matters', () => ({
  moderateScale: (n: number) => n,
  ms: (n: number) => n,
  mvs: (n: number) => n,
  s: (n: number) => n,
  vs: (n: number) => n,
  ScaledSheet: {create: (s: any) => s},
}));

import {calendarTheme, localeConfig} from '../calendarConfig';

describe('calendarConfig', () => {
  it('has expected theme keys and values', () => {
    expect(calendarTheme.calendarBackground).toBeTruthy();
    expect(calendarTheme['stylesheet.calendar.header']).toBeTruthy();
    expect(calendarTheme['stylesheet.day.basic']).toBeTruthy();
  });

  it('provides day initials in localeConfig', () => {
    expect(localeConfig.dayNamesShort).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  });
});



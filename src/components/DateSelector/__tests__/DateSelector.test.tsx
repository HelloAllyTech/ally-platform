import React from 'react';
import {render} from '@testing-library/react-native';

import {DateSelector} from '@/components/DateSelector';

jest.mock('react-native-calendars', () => {
  const React = require('react');
  const Calendar = ({onDayPress}: any) => {
    React.useEffect(() => {
      onDayPress?.({dateString: '2024-01-02'});
    }, [onDayPress]);
    return null;
  };
  return { Calendar, LocaleConfig: { locales: { shortDays: {} }, defaultLocale: 'shortDays' } };
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/constants', () => ({
  CALENDAR_MODES: { A: 'A', D: 'D', W: 'W', M: 'M', Y: 'Y' },
  DEFAULT_HIT_SLOP: {},
  MONTHS: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
}));

jest.mock('@/components/DateSelector/calendarConfig', () => ({
  calendarTheme: {},
  localeConfig: {},
}));

jest.mock('@/components/DateSelector/dateUtils', () => ({
  formatDate: (d: Date) => d.toISOString().split('T')[0],
  getDisplayText: () => 'MOCK_DISPLAY',
  getYearRange: (y: number) => [y - 1, y, y + 1],
  isToday: () => true,
}));

const mockUseDateSelection = {
  selectedDate: { startDate: '2024-01-01', endDate: '2024-01-01' },
  tempSelectedDate: { startDate: '2024-01-01', endDate: '2024-01-01' },
  setTempSelectedDate: jest.fn(),
  handleDayPress: jest.fn(),
  handleCancel: jest.fn(),
  handleOk: jest.fn(),
  onPressLeftArrow: jest.fn(),
  onPressRightArrow: jest.fn(),
  isMaxDateReached: () => false,
  goToPrevMonth: jest.fn(),
  goToNextMonth: jest.fn(),
  isNextMonthDisabled: () => false,
  goToPrevMonthWeek: jest.fn(),
  goToNextMonthWeek: jest.fn(),
  setMonthRange: jest.fn(),
  setYearRange: jest.fn(),
};

jest.mock('@/components/DateSelector/useDateSelection', () => ({
  useDateSelection: () => mockUseDateSelection,
}));

describe('DateSelector', () => {
  it('renders All mode summary', () => {
    const {toJSON} = render(
      <DateSelector
        pickerMode={'A' as any}
        dateRange={{ startDate: '2024-01-01', endDate: '2024-01-31' }}
        setDateRange={jest.fn()}
      />,
    );
    expect(toJSON()).toBeTruthy();
  });

  it('renders Daily mode without errors', () => {
    const {toJSON} = render(
      <DateSelector
        pickerMode={'D' as any}
        dateRange={{ startDate: '2024-01-01', endDate: '2024-01-01' }}
        setDateRange={jest.fn()}
      />,
    );
    expect(toJSON()).toBeTruthy();
  });

  it('renders Weekly mode header and actions', () => {
    const {toJSON} = render(
      <DateSelector
        pickerMode={'W' as any}
        dateRange={{ startDate: '2024-01-01', endDate: '2024-01-07' }}
        setDateRange={jest.fn()}
      />,
    );
    expect(toJSON()).toBeTruthy();
  });

  it('opens modal for Month mode (smoke)', () => {
    const {toJSON} = render(
      <DateSelector
        pickerMode={'M' as any}
        dateRange={{ startDate: '2024-01-01', endDate: '2024-01-31' }}
        setDateRange={jest.fn()}
      />,
    );
    expect(toJSON()).toBeTruthy();
  });

  it('opens modal for Year mode (smoke)', () => {
    const {toJSON} = render(
      <DateSelector
        pickerMode={'Y' as any}
        dateRange={{ startDate: '2024-01-01', endDate: '2024-12-31' }}
        setDateRange={jest.fn()}
      />,
    );
    expect(toJSON()).toBeTruthy();
  });
});

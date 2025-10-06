import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {Text} from 'react-native';

import {DateSelector} from '@/components/DateSelector';

jest.mock('react-native-calendars', () => {
  const React = require('react');
  const {Text} = require('react-native');
  const Calendar = ({onDayPress, markedDates, current, markingType}: any) => {
    React.useEffect(() => {
      onDayPress?.({dateString: '2024-01-02'});
    }, [onDayPress]);
    return (
      <>
        <Text testID="marked-keys">{Object.keys(markedDates || {}).join(',')}</Text>
        <Text testID="current-date">{current}</Text>
        <Text testID="marking-type">{markingType}</Text>
      </>
    );
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
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDateSelection.selectedDate = { startDate: '2024-01-01', endDate: '2024-01-01' } as any;
    mockUseDateSelection.tempSelectedDate = { startDate: '2024-01-01', endDate: '2024-01-01' } as any;
  });

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

  it('renders Daily mode and shows today label', () => {
    const {getByText} = render(
      <DateSelector
        pickerMode={'D' as any}
        dateRange={{ startDate: '2024-01-01', endDate: '2024-01-01' }}
        setDateRange={jest.fn()}
      />,
    );
    // isToday mocked to true, so today label should show
    expect(getByText('analytics.dateSelector.today')).toBeTruthy();
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

  it('opens modal when month selector pressed and closes on cancel', () => {
    const {getByText} = render(
      <DateSelector
        pickerMode={'D' as any}
        dateRange={{ startDate: '2024-01-01', endDate: '2024-01-01' }}
        setDateRange={jest.fn()}
      />,
    );
    // Month selector shows MOCK_DISPLAY
    fireEvent.press(getByText('MOCK_DISPLAY'));
    // Cancel button exists via translation key
    fireEvent.press(getByText('analytics.modal.cancel'));
    expect(mockUseDateSelection.handleCancel).toHaveBeenCalled();
  });

  it('handles month grid interactions', () => {
    const {getByText} = render(
      <DateSelector
        pickerMode={'M' as any}
        dateRange={{ startDate: '2023-01-01', endDate: '2023-01-31' }}
        setDateRange={jest.fn()}
      />,
    );
    // Open modal via month selector press
    fireEvent.press(getByText('MOCK_DISPLAY'));
    // Click on a month cell, e.g., Feb
    fireEvent.press(getByText('Feb'));
    expect(mockUseDateSelection.setMonthRange).toHaveBeenCalled();
  });

  it('handles year grid interactions', () => {
    const {getByText} = render(
      <DateSelector
        pickerMode={'Y' as any}
        dateRange={{ startDate: '2024-01-01', endDate: '2024-12-31' }}
        setDateRange={jest.fn()}
      />,
    );
    // Open modal via month selector press
    fireEvent.press(getByText('MOCK_DISPLAY'));
    // Click current year cell (from getYearRange mock)
    fireEvent.press(getByText(new Date('2024-01-01').getFullYear().toString()));
    expect(mockUseDateSelection.setYearRange).toHaveBeenCalled();
  });

  it('weekly markedDates shows full range when start and end provided', () => {
    mockUseDateSelection.tempSelectedDate = { startDate: '2024-01-01', endDate: '2024-01-03' } as any;
    const {getByTestId, getByText} = render(
      <DateSelector
        pickerMode={'W' as any}
        dateRange={{ startDate: '2024-01-01', endDate: '2024-01-03' }}
        setDateRange={jest.fn()}
      />,
    );
    // open modal to render Calendar
    fireEvent.press(getByText('MOCK_DISPLAY'));
    const keys = getByTestId('marked-keys').props.children.split(',');
    expect(keys).toEqual(expect.arrayContaining(['2024-01-01','2024-01-02','2024-01-03']));
    expect(getByTestId('marking-type').props.children).toBe('period');
  });

  it('weekly markedDates shows start-only when only start provided', () => {
    mockUseDateSelection.tempSelectedDate = { startDate: '2024-02-01', endDate: null } as any;
    const {getByTestId, getByText} = render(
      <DateSelector
        pickerMode={'W' as any}
        dateRange={{ startDate: '2024-02-01', endDate: '2024-02-01' }}
        setDateRange={jest.fn()}
      />,
    );
    fireEvent.press(getByText('MOCK_DISPLAY'));
    expect(getByTestId('marked-keys').props.children).toBe('2024-02-01');
  });
});

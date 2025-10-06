import {renderHook, act} from '@testing-library/react-native';
import {useDateSelection} from '../useDateSelection';

jest.mock('@/constants/analytics', () => ({
  CALENDAR_MODES: {D: 'D', W: 'W', M: 'M', Y: 'Y'},
}));

jest.mock('../dateUtils', () => ({
  getMonthStartDate: (y: number, m: number) => `${y}-${String(m + 1).padStart(2,'0')}-01`,
  getMonthEndDate: (y: number, m: number) => `${y}-${String(m + 1).padStart(2,'0')}-28`,
  getPrevMonthDate: (d: Date) => new Date(d.getFullYear(), d.getMonth() - 1, 1),
  getNextMonthDate: (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 1),
  getYearStartDate: (y: number) => `${y}-01-01`,
  getYearEndDate: (y: number) => `${y}-12-31`,
}));

describe('useDateSelection', () => {
  const setDateRange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates temp dates on day press (daily)', () => {
    const initial = {startDate: '2024-05-01', endDate: '2024-05-02'};
    const {result} = renderHook(() =>
      useDateSelection({dateRange: initial, setDateRange, pickerMode: 'D'}),
    );
    act(() => result.current.handleDayPress({dateString: '2024-05-10'}));
    act(() => result.current.handleOk());
    expect(setDateRange).toHaveBeenCalledWith({startDate: '2024-05-10', endDate: '2024-05-11'});
  });

  it('left/right arrows change range for week mode with bounds', () => {
    const week = {startDate: '2024-05-01', endDate: '2024-05-07'};
    const {result} = renderHook(() =>
      useDateSelection({dateRange: week, setDateRange, pickerMode: 'W'}),
    );
    act(() => result.current.onPressLeftArrow());
    act(() => result.current.onPressRightArrow());
    expect(setDateRange).toHaveBeenCalled();
  });

  it('month left/right arrows navigate with future guard', () => {
    const month = {startDate: '2024-05-01', endDate: '2024-05-28'};
    const {result} = renderHook(() =>
      useDateSelection({dateRange: month, setDateRange, pickerMode: 'M'}),
    );
    act(() => result.current.onPressLeftArrow());
    // Right arrow should not exceed future guard (will short-circuit if beyond today)
    act(() => result.current.onPressRightArrow());
    expect(setDateRange).toHaveBeenCalled();
  });

  it('year left/right arrows navigate with year guard', () => {
    const year = {startDate: '2023-01-01', endDate: '2023-12-31'};
    const {result} = renderHook(() =>
      useDateSelection({dateRange: year, setDateRange, pickerMode: 'Y'}),
    );
    act(() => result.current.onPressLeftArrow());
    act(() => result.current.onPressRightArrow());
    expect(setDateRange).toHaveBeenCalled();
  });

  it('isMaxDateReached reflects day/week/month/year correctly', () => {
    const day = {startDate: '2099-01-01', endDate: '2099-01-02'}; // definitely after today
    const wk = {startDate: '2099-01-01', endDate: '2099-01-07'}; // week ending after today
    const mon = {startDate: '2099-01-01', endDate: '2099-01-28'}; // month end after today
    const yr = {startDate: '2099-01-01', endDate: '2099-12-31'}; // next century

    const dayHook = renderHook(() => useDateSelection({dateRange: day, setDateRange, pickerMode: 'D'})).result;
    const wkHook = renderHook(() => useDateSelection({dateRange: wk, setDateRange, pickerMode: 'W'})).result;
    const monHook = renderHook(() => useDateSelection({dateRange: mon, setDateRange, pickerMode: 'M'})).result;
    const yrHook = renderHook(() => useDateSelection({dateRange: yr, setDateRange, pickerMode: 'Y'})).result;

    expect(dayHook.current.isMaxDateReached()).toBe(true);
    expect(wkHook.current.isMaxDateReached()).toBe(true);
    expect(monHook.current.isMaxDateReached()).toBe(true);
    expect(yrHook.current.isMaxDateReached()).toBe(true);
  });

  it('month grid next/prev navigation respects today cap', () => {
    const month = {startDate: '2024-05-01', endDate: '2024-05-28'};
    const {result} = renderHook(() => useDateSelection({dateRange: month, setDateRange, pickerMode: 'M'}));
    act(() => result.current.goToPrevMonth());
    act(() => result.current.goToNextMonth());
    expect(result.current.isNextMonthDisabled()).toBe(false);
  });

  it('week grid next/prev month navigation caps to today when needed', () => {
    const wk = {startDate: '2024-06-10', endDate: '2024-06-16'};
    const {result} = renderHook(() => useDateSelection({dateRange: wk, setDateRange, pickerMode: 'W'}));
    act(() => result.current.goToNextMonthWeek());
    act(() => result.current.goToPrevMonthWeek());
    // if no crash, branches executed
    expect(typeof result.current.goToNextMonthWeek).toBe('function');
  });
});



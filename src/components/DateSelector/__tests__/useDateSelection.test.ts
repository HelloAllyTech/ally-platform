import {renderHook, act} from '@testing-library/react-native';
import {useDateSelection} from '../useDateSelection';

jest.mock('@/constants/analytics', () => ({
  CALENDAR_MODES: {D: 'D', W: 'W', M: 'M', Y: 'Y'},
}));

jest.mock('../dateUtils', () => ({
  getMonthStartDate: (y: number, m: number) => `${y}-0${m + 1}-01`.slice(-10),
  getMonthEndDate: (y: number, m: number) => `${y}-0${m + 1}-28`.slice(-10),
  getPrevMonthDate: (d: Date) => new Date(d.getFullYear(), d.getMonth() - 1, 1),
  getNextMonthDate: (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 1),
  getYearStartDate: (y: number) => `${y}-01-01`,
  getYearEndDate: (y: number) => `${y}-12-31`,
}));

describe('useDateSelection', () => {
  const initial = {startDate: '2024-05-01', endDate: '2024-05-02'};
  const setDateRange = jest.fn();

  it('updates temp dates on day press (daily)', () => {
    const {result} = renderHook(() =>
      useDateSelection({dateRange: initial, setDateRange, pickerMode: 'D'}),
    );
    act(() => result.current.handleDayPress({dateString: '2024-05-10'}));
    act(() => result.current.handleOk());
    expect(setDateRange).toHaveBeenCalled();
  });

  it('left/right arrows change range for week mode with bounds', () => {
    const week = {startDate: '2024-05-01', endDate: '2024-05-07'};
    const {result} = renderHook(() =>
      useDateSelection({dateRange: week, setDateRange, pickerMode: 'W'}),
    );
    act(() => result.current.onPressLeftArrow());
    act(() => result.current.onPressRightArrow());
  });
});



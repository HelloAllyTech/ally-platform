import {useEffect, useState} from 'react';

import {CALENDAR_MODES} from '@/constants/analytics';

import {
  getMonthEndDate,
  getMonthStartDate,
  getNextMonthDate,
  getPrevMonthDate,
  getYearEndDate,
  getYearStartDate,
} from './dateUtils';

interface DateRange {
  startDate: string;
  endDate: string;
}

interface UseDateSelectionProps {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  pickerMode: string;
}

// Utility functions for date manipulation
const formatDate = (date: Date): string => date.toISOString().split('T')[0];

const getNextDayRange = (date: Date): DateRange => {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);
  return {
    startDate: formatDate(date),
    endDate: formatDate(nextDate),
  };
};

const getWeekRange = (startDate: Date, endDate: Date): DateRange => ({
  startDate: formatDate(startDate),
  endDate: formatDate(endDate),
});

const getMonthRange = (year: number, month: number): DateRange => ({
  startDate: getMonthStartDate(year, month),
  endDate: getMonthEndDate(year, month),
});

const getYearRange = (year: number): DateRange => ({
  startDate: getYearStartDate(year),
  endDate: getYearEndDate(year),
});

const isDateBeyondToday = (date: Date): boolean => {
  const today = new Date();
  return date > today;
};

export const useDateSelection = ({
  dateRange,
  setDateRange,
  pickerMode,
}: UseDateSelectionProps) => {
  const [selectedDate, setSelectedDate] = useState<DateRange>(dateRange);
  const [tempSelectedDate, setTempSelectedDate] =
    useState<DateRange>(dateRange);

  useEffect(() => {
    setTempSelectedDate(dateRange);
    setSelectedDate(dateRange);
  }, [dateRange]);

  const setTempDateRange = (startDate: string, endDate: string) => {
    setTempSelectedDate({startDate, endDate});
  };

  const handleDayPress = (day: {dateString: string}) => {
    if (pickerMode === CALENDAR_MODES.W) {
      handleWeekDayPress(day);
    } else {
      const {startDate, endDate} = getNextDayRange(new Date(day.dateString));
      setTempDateRange(startDate, endDate);
    }
  };

  const handleWeekDayPress = (day: {dateString: string}) => {
    const clickedDate = new Date(day.dateString);

    if (day.dateString === tempSelectedDate.startDate) {
      setTempDateRange('', '');
      return;
    }
    if (day.dateString === tempSelectedDate.endDate) {
      setTempSelectedDate({
        ...tempSelectedDate,
        endDate: '',
      });
      return;
    }

    if (!tempSelectedDate.startDate) {
      setTempDateRange(day.dateString, day.dateString);
    } else {
      const startDate = new Date(tempSelectedDate.startDate);
      if (clickedDate < startDate) {
        setTempDateRange(day.dateString, tempSelectedDate.startDate);
      } else {
        setTempSelectedDate({
          ...tempSelectedDate,
          endDate: day.dateString,
        });
      }
    }
  };

  const handleCancel = () => {
    setTempSelectedDate(selectedDate);
  };

  const handleOk = () => {
    setSelectedDate(tempSelectedDate);
    setDateRange(tempSelectedDate);
  };

  const onPressLeftArrow = () => {
    const currentDate = new Date(selectedDate.startDate);
    let newRange: DateRange;

    switch (pickerMode) {
      case CALENDAR_MODES.D: {
        currentDate.setDate(currentDate.getDate() - 1);
        newRange = getNextDayRange(currentDate);
        break;
      }
      case CALENDAR_MODES.W: {
        const currentEndDate = new Date(selectedDate.endDate);
        currentDate.setDate(currentDate.getDate() - 7);
        currentEndDate.setDate(currentEndDate.getDate() - 7);
        newRange = getWeekRange(currentDate, currentEndDate);
        break;
      }
      case CALENDAR_MODES.M: {
        const newMonth =
          currentDate.getMonth() === 0 ? 11 : currentDate.getMonth() - 1;
        const newYear =
          currentDate.getMonth() === 0
            ? currentDate.getFullYear() - 1
            : currentDate.getFullYear();
        newRange = getMonthRange(newYear, newMonth);
        break;
      }
      case CALENDAR_MODES.Y: {
        const year = currentDate.getFullYear() - 1;
        newRange = getYearRange(year);
        break;
      }
      default:
        return;
    }

    setDateRange(newRange);
  };

  const onPressRightArrow = () => {
    const currentDate = new Date(selectedDate.startDate);
    let newRange: DateRange;

    switch (pickerMode) {
      case CALENDAR_MODES.D: {
        currentDate.setDate(currentDate.getDate() + 1);
        if (isDateBeyondToday(currentDate)) return;
        newRange = getNextDayRange(currentDate);
        break;
      }
      case CALENDAR_MODES.W: {
        const currentEndDate = new Date(selectedDate.endDate);
        currentDate.setDate(currentDate.getDate() + 7);
        currentEndDate.setDate(currentEndDate.getDate() + 7);
        if (isDateBeyondToday(currentDate)) return;
        newRange = getWeekRange(currentDate, currentEndDate);
        break;
      }
      case CALENDAR_MODES.M: {
        const newMonth =
          currentDate.getMonth() === 11 ? 0 : currentDate.getMonth() + 1;
        const newYear =
          currentDate.getMonth() === 11
            ? currentDate.getFullYear() + 1
            : currentDate.getFullYear();
        const newDate = getMonthStartDate(newYear, newMonth);
        if (isDateBeyondToday(new Date(newDate))) return;
        newRange = getMonthRange(newYear, newMonth);
        break;
      }
      case CALENDAR_MODES.Y: {
        const year = currentDate.getFullYear() + 1;
        if (year > new Date().getFullYear()) return;
        newRange = getYearRange(year);
        break;
      }
      default:
        return;
    }

    setDateRange(newRange);
  };

  const isMaxDateReached = () => {
    const today = new Date();
    const currentDate = new Date(selectedDate.startDate);

    switch (pickerMode) {
      case CALENDAR_MODES.D:
        return (
          currentDate > today ||
          currentDate.toDateString() === today.toDateString()
        );
      case CALENDAR_MODES.W:
        return new Date(selectedDate.endDate) >= today;
      case CALENDAR_MODES.M:
        return (
          new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0) >
          today
        );
      case CALENDAR_MODES.Y:
        return new Date(currentDate.getFullYear(), 11, 31) > today;
      default:
        return false;
    }
  };

  const goToPrevMonth = () => {
    const current = new Date(tempSelectedDate.startDate);
    const prevMonth = getPrevMonthDate(current);
    setTempSelectedDate(
      getMonthRange(prevMonth.getFullYear(), prevMonth.getMonth()),
    );
  };

  const goToNextMonth = () => {
    const current = new Date(tempSelectedDate.startDate);
    const nextMonth = getNextMonthDate(current);
    const today = new Date();

    if (
      nextMonth.getFullYear() === today.getFullYear() &&
      nextMonth.getMonth() === today.getMonth()
    ) {
      setTempSelectedDate(getMonthRange(today.getFullYear(), today.getMonth()));
    } else if (nextMonth < today) {
      setTempSelectedDate(
        getMonthRange(nextMonth.getFullYear(), nextMonth.getMonth()),
      );
    }
  };

  const goToNextMonthWeek = () => {
    if (
      pickerMode !== CALENDAR_MODES.W ||
      !tempSelectedDate.startDate ||
      !tempSelectedDate.endDate
    )
      return;

    const today = new Date();
    const start = new Date(tempSelectedDate.startDate);
    const end = new Date(tempSelectedDate.endDate);

    const nextStart = new Date(start);
    nextStart.setMonth(start.getMonth() + 1);

    const nextEnd = new Date(end);
    nextEnd.setMonth(end.getMonth() + 1);

    if (nextEnd > today) {
      const cappedEnd = new Date(today);
      const cappedStart = new Date(today);
      cappedStart.setDate(today.getDate() - 6);
      setTempSelectedDate(getWeekRange(cappedStart, cappedEnd));
      return;
    }

    setTempSelectedDate(getWeekRange(nextStart, nextEnd));
  };

  const goToPrevMonthWeek = () => {
    if (
      pickerMode !== CALENDAR_MODES.W ||
      !tempSelectedDate.startDate ||
      !tempSelectedDate.endDate
    )
      return;

    const start = new Date(tempSelectedDate.startDate);
    const end = new Date(tempSelectedDate.endDate);

    const prevStart = new Date(start);
    prevStart.setMonth(start.getMonth() - 1);

    const prevEnd = new Date(end);
    prevEnd.setMonth(end.getMonth() - 1);

    setTempSelectedDate(getWeekRange(prevStart, prevEnd));
  };

  const isNextMonthDisabled = () => {
    const current = new Date(tempSelectedDate.startDate);
    const nextMonth = getNextMonthDate(current);
    return nextMonth > new Date();
  };

  return {
    selectedDate,
    tempSelectedDate,
    setTempSelectedDate,
    handleDayPress,
    handleCancel,
    handleOk,
    onPressLeftArrow,
    onPressRightArrow,
    isMaxDateReached,
    goToPrevMonth,
    goToNextMonth,
    isNextMonthDisabled,
    goToPrevMonthWeek,
    goToNextMonthWeek,
    setMonthRange: (year: number, month: number) =>
      setTempDateRange(
        getMonthStartDate(year, month),
        getMonthEndDate(year, month),
      ),
    setYearRange: (year: number) =>
      setTempDateRange(getYearStartDate(year), getYearEndDate(year)),
  };
};

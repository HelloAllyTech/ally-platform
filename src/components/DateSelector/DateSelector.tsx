import React, {useCallback, useMemo, useState} from 'react';
import {Modal, Text, TouchableOpacity, View} from 'react-native';
import {Calendar, LocaleConfig} from 'react-native-calendars';

import {LeftArrow, RightArrow} from '@/assets';
import {CALENDAR_MODES, DEFAULT_HIT_SLOP, MONTHS} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';
import {DateSelectorProps, MarkedDates} from '@/types';

import {calendarTheme, localeConfig} from './calendarConfig';
import {formatDate, getDisplayText, getYearRange, isToday} from './dateUtils';
import {styles} from './styles';
import {useDateSelection} from './useDateSelection';

// Configure calendar locale
LocaleConfig.locales.shortDays = localeConfig;
LocaleConfig.defaultLocale = 'shortDays';

/**
 * DateSelector component for selecting dates in different modes (day, week, month, year)
 * @param props - The component props
 * @returns A React component for date selection
 */
export const DateSelector: React.FC<DateSelectorProps> = ({
  pickerMode,
  dateRange,
  setDateRange,
}) => {
  const {t} = useTranslate();
  const [modalVisible, setModalVisible] = useState(false);

  const {
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
    setMonthRange,
    setYearRange,
  } = useDateSelection({
    dateRange,
    setDateRange,
    pickerMode,
  });

  // Convert date strings to Date objects once for reuse
  const startDateObj = useMemo(
    () =>
      tempSelectedDate.startDate ? new Date(tempSelectedDate.startDate) : null,
    [tempSelectedDate.startDate],
  );
  const endDateObj = useMemo(
    () =>
      tempSelectedDate.endDate ? new Date(tempSelectedDate.endDate) : null,
    [tempSelectedDate.endDate],
  );

  // Get current date info for reuse
  const currentDateInfo = useMemo(() => {
    if (!startDateObj) return {month: 0, year: new Date().getFullYear()};
    return {
      month: startDateObj.getMonth(),
      year: startDateObj.getFullYear(),
    };
  }, [startDateObj]);

  // Get today's date info for reuse
  const todayInfo = useMemo(() => {
    const today = new Date();
    return {
      year: today.getFullYear(),
      month: today.getMonth(),
      dateString: today.toISOString().split('T')[0],
    };
  }, []);

  const closeModal = useCallback(() => {
    handleCancel();
    setModalVisible(false);
  }, [handleCancel]);

  const openDatePicker = useCallback(() => {
    setTempSelectedDate(selectedDate);
    setModalVisible(true);
  }, [selectedDate, setTempSelectedDate]);

  const getWeekMarkedDates = useCallback((): MarkedDates => {
    const markedDates: MarkedDates = {};

    if (startDateObj && endDateObj) {
      const current = new Date(startDateObj);

      while (current <= endDateObj) {
        const dateString = current.toISOString().split('T')[0];
        const isStartDate = dateString === tempSelectedDate.startDate;
        const isEndDate = dateString === tempSelectedDate.endDate;
        const isBoundaryDate = isStartDate || isEndDate;

        markedDates[dateString] = {
          color: isBoundaryDate ? colors.azureBlue : colors.lightBlue3,
          startingDay: isStartDate,
          endingDay: isEndDate,
        };
        current.setDate(current.getDate() + 1);
      }
    } else if (tempSelectedDate.startDate) {
      markedDates[tempSelectedDate.startDate] = {
        color: colors.azureBlue,
        startingDay: true,
        selected: true,
      };
    } else if (tempSelectedDate.endDate) {
      markedDates[tempSelectedDate.endDate] = {
        color: colors.azureBlue,
        endingDay: true,
        selected: true,
      };
    }
    return markedDates;
  }, [
    startDateObj,
    endDateObj,
    tempSelectedDate.startDate,
    tempSelectedDate.endDate,
  ]);

  const getMarkedDates = useCallback((): MarkedDates => {
    if (pickerMode === CALENDAR_MODES.W) {
      return getWeekMarkedDates();
    }

    return {
      [tempSelectedDate.startDate]: {
        selected: true,
        color: colors.blue,
      },
    };
  }, [pickerMode, tempSelectedDate.startDate, getWeekMarkedDates]);

  const handleMonthPress = useCallback(
    (monthIndex: number, isDisabled: boolean) => {
      if (!isDisabled) {
        setMonthRange(currentDateInfo.year, monthIndex);
      }
    },
    [currentDateInfo.year, setMonthRange],
  );

  const handleYearPress = useCallback(
    (year: number) => {
      setYearRange(year);
    },
    [setYearRange],
  );

  const handleLeftArrowPress = useCallback(() => {
    setMonthRange(currentDateInfo.year - 1, currentDateInfo.month);
  }, [currentDateInfo.year, currentDateInfo.month, setMonthRange]);

  const handleRightArrowPress = useCallback(() => {
    const isNextYearDisabled = currentDateInfo.year >= todayInfo.year;
    if (!isNextYearDisabled) {
      setMonthRange(currentDateInfo.year + 1, currentDateInfo.month);
    }
  }, [
    currentDateInfo.year,
    currentDateInfo.month,
    todayInfo.year,
    setMonthRange,
  ]);

  const renderMonthGrid = useCallback(() => {
    const isNextYearDisabled = currentDateInfo.year >= todayInfo.year;

    return (
      <View style={styles.monthGridContainer}>
        <View style={styles.monthGridHeader}>
          <Text style={[styles.modalTitle, styles.monthTitle]}>
            {t('analytics.dateSelector.selectMonth')}
          </Text>
          <View style={styles.yearRow}>
            <TouchableOpacity
              hitSlop={DEFAULT_HIT_SLOP}
              onPress={handleLeftArrowPress}>
              <LeftArrow width={12} height={12} />
            </TouchableOpacity>
            <View style={styles.yearWrapper}>
              <Text style={styles.yearText}>{currentDateInfo.year}</Text>
            </View>
            <TouchableOpacity
              hitSlop={DEFAULT_HIT_SLOP}
              disabled={isNextYearDisabled}
              onPress={handleRightArrowPress}>
              <RightArrow
                width={12}
                height={12}
                opacity={isNextYearDisabled ? 0.5 : 1}
              />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.monthGrid}>
          {MONTHS.map((monthName, monthIndex) => {
            const isDisabled =
              currentDateInfo.year === todayInfo.year &&
              monthIndex > todayInfo.month;
            return (
              <TouchableOpacity
                key={monthName}
                style={[
                  styles.monthCell,
                  currentDateInfo.month === monthIndex &&
                    styles.monthCellSelected,
                ]}
                disabled={isDisabled}
                onPress={() => handleMonthPress(monthIndex, isDisabled)}>
                <Text
                  style={[
                    styles.monthCellText,
                    currentDateInfo.month === monthIndex &&
                      styles.monthCellTextSelected,
                    isDisabled && {color: colors.lightGray4},
                  ]}>
                  {monthName}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }, [
    currentDateInfo,
    todayInfo,
    t,
    handleLeftArrowPress,
    handleRightArrowPress,
    handleMonthPress,
  ]);

  const renderYearGrid = useCallback(() => {
    const years = getYearRange(currentDateInfo.year);

    return (
      <View style={styles.yearGridContainer}>
        <Text style={[styles.modalTitle, styles.yearTitle]}>
          {t('analytics.dateSelector.selectYear')}
        </Text>
        <View style={styles.yearGrid}>
          {years.map(year => {
            const isDisabled = year > todayInfo.year;
            return (
              <TouchableOpacity
                key={year}
                style={[
                  styles.yearCell,
                  currentDateInfo.year === year && styles.yearCellSelected,
                ]}
                disabled={isDisabled}
                onPress={() => handleYearPress(year)}>
                <Text
                  style={[
                    styles.yearCellText,
                    currentDateInfo.year === year &&
                      styles.yearCellTextSelected,
                    isDisabled && styles.disabledYear,
                  ]}>
                  {year}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }, [currentDateInfo.year, todayInfo.year, t, handleYearPress]);

  const renderDayHeader = useCallback(() => {
    if (!startDateObj) return null;

    const month = startDateObj.toLocaleString('default', {month: 'short'});
    const year = startDateObj.getFullYear();
    const headerDay = `${month} ${year}`;

    const headerWeek =
      startDateObj && endDateObj
        ? `${formatDate(startDateObj)} - ${formatDate(endDateObj)}`
        : '';

    const header = pickerMode === CALENDAR_MODES.D ? headerDay : headerWeek;

    return (
      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{header}</Text>
        <View style={styles.dayHeaderArrowContainer}>
          <TouchableOpacity
            style={styles.iconContainer}
            onPress={
              pickerMode === CALENDAR_MODES.W
                ? goToPrevMonthWeek
                : goToPrevMonth
            }>
            <LeftArrow width={6} height={12} color={colors.lightGray12} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconContainer}
            onPress={
              pickerMode === CALENDAR_MODES.W
                ? goToNextMonthWeek
                : goToNextMonth
            }
            disabled={isNextMonthDisabled()}>
            <RightArrow
              width={6}
              height={12}
              color={
                isNextMonthDisabled() ? colors.lightGray4 : colors.lightGray12
              }
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [
    startDateObj,
    endDateObj,
    pickerMode,
    goToPrevMonthWeek,
    goToPrevMonth,
    goToNextMonthWeek,
    goToNextMonth,
    isNextMonthDisabled,
  ]);

  const renderAllGrid = useCallback(() => {
    const formatDateToDisplay = (dateString: string): string => {
      const date = new Date(dateString);
      const day = date.getDate().toString().padStart(2, '0');
      const month = date.toLocaleString('en-US', {month: 'short'});
      const year = date.getFullYear();
      return `${day} ${month} ${year}`;
    };

    const formattedStartDate = formatDateToDisplay(dateRange.startDate);
    const formattedEndDate = formatDateToDisplay(dateRange.endDate);

    return (
      <View style={styles.allGridContainer}>
        <Text style={styles.allGridText}>
          {formattedStartDate} - {formattedEndDate}
        </Text>
      </View>
    );
  }, [dateRange.startDate, dateRange.endDate]);

  const renderPickerModal = useCallback(
    () => (
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            {(pickerMode === CALENDAR_MODES.W ||
              pickerMode === CALENDAR_MODES.D) && (
              <View style={styles.modalHeader}>
                {renderDayHeader()}
                <Calendar
                  key={tempSelectedDate.startDate.slice(0, 7)}
                  markingType={
                    pickerMode === CALENDAR_MODES.W ? 'period' : 'custom'
                  }
                  current={tempSelectedDate.startDate}
                  onDayPress={handleDayPress}
                  markedDates={getMarkedDates()}
                  theme={calendarTheme}
                  style={styles.calendarContainer}
                  maxDate={todayInfo.dateString}
                />
              </View>
            )}
            {pickerMode === CALENDAR_MODES.M && renderMonthGrid()}
            {pickerMode === CALENDAR_MODES.Y && renderYearGrid()}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalButton}
                hitSlop={DEFAULT_HIT_SLOP}
                onPress={closeModal}>
                <Text style={styles.modalCancel}>
                  {t('analytics.modal.cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButton}
                hitSlop={DEFAULT_HIT_SLOP}
                onPress={() => {
                  handleOk();
                  setModalVisible(false);
                }}>
                <Text style={styles.modalOk}>{t('analytics.modal.ok')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    ),
    [
      modalVisible,
      closeModal,
      pickerMode,
      renderDayHeader,
      tempSelectedDate.startDate,
      handleDayPress,
      getMarkedDates,
      todayInfo.dateString,
      renderMonthGrid,
      renderYearGrid,
      t,
      handleOk,
    ],
  );

  const isAllMode = pickerMode === CALENDAR_MODES.A;
  const isTodaySelected = useMemo(
    () =>
      isToday(new Date(selectedDate.startDate)) &&
      pickerMode === CALENDAR_MODES.D,
    [selectedDate.startDate, pickerMode],
  );

  return (
    <>
      {isAllMode && renderAllGrid()}
      {!isAllMode && (
        <>
          {renderPickerModal()}
          <View style={styles.dateSelector}>
            <TouchableOpacity
              onPress={onPressLeftArrow}
              style={styles.arrowContainer}>
              <LeftArrow width={12} height={12} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openDatePicker}
              style={styles.monthSelector}>
              {isTodaySelected && (
                <Text style={styles.todayText}>
                  {t('analytics.dateSelector.today')}
                </Text>
              )}
              <Text style={styles.monthText}>
                {getDisplayText(
                  pickerMode,
                  selectedDate.startDate,
                  selectedDate.endDate,
                )}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onPressRightArrow}
              style={[
                styles.arrowContainer,
                isMaxDateReached() && styles.disabledArrow,
              ]}
              disabled={isMaxDateReached()}>
              <RightArrow
                width={12}
                height={12}
                color={
                  isMaxDateReached() ? colors.lightGray12 : colors.darkSlate
                }
              />
            </TouchableOpacity>
          </View>
        </>
      )}
    </>
  );
};

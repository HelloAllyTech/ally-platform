import React, {useState} from 'react';
import {Modal, Text, TouchableOpacity, View} from 'react-native';
import {Calendar, LocaleConfig} from 'react-native-calendars';

import {LeftArrow, RightArrow} from '@/assets/icons';
import {CALENDAR_MODES, MONTHS} from '@/constants/analytics';
import {DEFAULT_HIT_SLOP} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';

import {calendarTheme, localeConfig} from './calendarConfig';
import {formatDate, getDisplayText, getYearRange, isToday} from './dateUtils';
import {styles} from './styles';
import {useDateSelection} from './useDateSelection';

// Configure calendar locale
LocaleConfig.locales.shortDays = localeConfig;
LocaleConfig.defaultLocale = 'shortDays';

/**
 * Props for the DateSelector component
 */
interface DateSelectorProps {
  pickerMode: string;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  setDateRange: ({
    startDate,
    endDate,
  }: {
    startDate: string;
    endDate: string;
  }) => void;
}

/**
 * Interface for calendar day marking
 */
interface MarkedDates {
  [key: string]: {
    color: string;
    startingDay?: boolean;
    endingDay?: boolean;
    selected?: boolean;
  };
}

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

  const getMarkedDates = (): MarkedDates => {
    if (pickerMode === CALENDAR_MODES.W) {
      return getWeekMarkedDates();
    }

    return {
      [tempSelectedDate.startDate]: {
        selected: true,
        color: colors.blue,
      },
    };
  };

  const getWeekMarkedDates = (): MarkedDates => {
    const markedDates: MarkedDates = {};

    if (tempSelectedDate.startDate && tempSelectedDate.endDate) {
      const start = new Date(tempSelectedDate.startDate);
      const end = new Date(tempSelectedDate.endDate);
      const current = new Date(start);

      while (current <= end) {
        const dateString = current.toISOString().split('T')[0];
        markedDates[dateString] = {
          color:
            dateString === tempSelectedDate.startDate ||
            dateString === tempSelectedDate.endDate
              ? colors.azureBlue
              : colors.lightBlue3,
          startingDay: dateString === tempSelectedDate.startDate,
          endingDay: dateString === tempSelectedDate.endDate,
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
  };

  const openDatePicker = () => {
    setTempSelectedDate(selectedDate);
    setModalVisible(true);
  };

  const renderMonthGrid = () => {
    const currentDate = new Date(tempSelectedDate.startDate);
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();

    const today = new Date();
    const thisYear = today.getFullYear();
    const thisMonth = today.getMonth();

    const isNextYearDisabled = currentYear >= thisYear;

    return (
      <View style={styles.monthGridContainer}>
        <View style={styles.monthGridHeader}>
          <Text style={[styles.modalTitle, styles.monthTitle]}>
            {t('analytics.dateSelector.selectMonth')}
          </Text>
          <View style={styles.yearRow}>
            <TouchableOpacity
              hitSlop={DEFAULT_HIT_SLOP}
              onPress={() => {
                setMonthRange(currentYear - 1, currentMonth);
              }}>
              <LeftArrow width={12} height={12} />
            </TouchableOpacity>
            <View style={styles.yearWrapper}>
              <Text style={styles.yearText}>{currentYear}</Text>
            </View>
            <TouchableOpacity
              hitSlop={DEFAULT_HIT_SLOP}
              disabled={isNextYearDisabled}
              onPress={() => {
                if (!isNextYearDisabled) {
                  setMonthRange(currentYear + 1, currentMonth);
                }
              }}>
              <RightArrow
                width={12}
                height={12}
                opacity={isNextYearDisabled ? 0.5 : 1}
              />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.monthGrid}>
          {MONTHS.map((m, idx) => {
            const isDisabled = currentYear === thisYear && idx > thisMonth;
            return (
              <TouchableOpacity
                key={m}
                style={[
                  styles.monthCell,
                  currentMonth === idx && styles.monthCellSelected,
                ]}
                disabled={isDisabled}
                onPress={() => {
                  if (!isDisabled) {
                    setMonthRange(currentYear, idx);
                  }
                }}>
                <Text
                  style={[
                    styles.monthCellText,
                    currentMonth === idx && styles.monthCellTextSelected,
                    isDisabled && {color: colors.lightGray4},
                  ]}>
                  {m}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  const renderYearGrid = () => {
    const currentYear = new Date(tempSelectedDate.startDate).getFullYear();
    const years = getYearRange(currentYear);

    return (
      <View style={styles.yearGridContainer}>
        <Text style={[styles.modalTitle, styles.yearTitle]}>
          {t('analytics.dateSelector.selectYear')}
        </Text>
        <View style={styles.yearGrid}>
          {years.map(y => (
            <TouchableOpacity
              key={y}
              style={[
                styles.yearCell,
                currentYear === y && styles.yearCellSelected,
              ]}
              disabled={y > new Date().getFullYear()}
              onPress={() => {
                setYearRange(y);
              }}>
              <Text
                style={[
                  styles.yearCellText,
                  currentYear === y && styles.yearCellTextSelected,
                  y > new Date().getFullYear() && styles.disabledYear,
                ]}>
                {y}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderDayHeader = () => {
    const date = new Date(tempSelectedDate.startDate);
    const month = date.toLocaleString('default', {month: 'short'});
    const year = date.getFullYear();

    const headerDay = `${month} ${year}`;

    const startDate = new Date(tempSelectedDate.startDate);
    const endDateObj = new Date(tempSelectedDate.endDate);
    const headerWeek = `${formatDate(startDate)} - ${formatDate(endDateObj)}`;

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
  };

  const renderAllGrid = () => {
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
  };

  const renderPickerModal = () => (
    <Modal
      visible={modalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        handleCancel();
        setModalVisible(false);
      }}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalContent}>
          {(pickerMode === CALENDAR_MODES.W ||
            pickerMode === CALENDAR_MODES.D) && (
            <View style={styles.modalHeader}>
              {(pickerMode === CALENDAR_MODES.D ||
                pickerMode === CALENDAR_MODES.W) &&
                renderDayHeader()}
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
                maxDate={new Date().toISOString().split('T')[0]}
              />
            </View>
          )}
          {pickerMode === CALENDAR_MODES.M && renderMonthGrid()}
          {pickerMode === CALENDAR_MODES.Y && renderYearGrid()}
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={styles.modalButton}
              hitSlop={DEFAULT_HIT_SLOP}
              onPress={() => {
                handleCancel();
                setModalVisible(false);
              }}>
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
  );

  return (
    <>
      {pickerMode === CALENDAR_MODES.A && renderAllGrid()}
      {pickerMode !== CALENDAR_MODES.A && (
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
              {isToday(new Date(selectedDate.startDate)) &&
                pickerMode === CALENDAR_MODES.D && (
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

import React, {useState} from 'react';
import {Modal, Text, TouchableOpacity, View} from 'react-native';
import {Calendar} from 'react-native-calendars';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrow, RightArrow} from '@/assets/icons';
import {CALENDAR_MODES, MONTHS, YEARS} from '@/constants/analytics';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

/**
 * Props for the DateSelector component
 */
interface DateSelectorProps {
  pickerMode: string;
  initialDate: string;
  onChangeDate: (date: string) => void;
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
  initialDate,
  onChangeDate,
}) => {
  const {t} = useTranslate();
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [tempSelectedDate, setTempSelectedDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [tempEndDate, setTempEndDate] = useState(initialDate);
  const [selectedMonth, setSelectedMonth] = useState(0);
  const [tempSelectedMonth, setTempSelectedMonth] = useState(0);
  const [selectedYearGrid, setSelectedYearGrid] = useState(2025);
  const [tempSelectedYearGrid, setTempSelectedYearGrid] = useState(2025);

  const {W, D, M, Y} = CALENDAR_MODES;

  /**
   * Handles the cancel action in the modal
   */
  const handleCancel = () => {
    setTempSelectedDate(selectedDate);
    setTempEndDate(endDate);
    setTempSelectedMonth(selectedMonth);
    setTempSelectedYearGrid(selectedYearGrid);
    setModalVisible(false);
  };

  /**
   * Handles the confirm action in the modal
   */
  const handleOk = () => {
    setSelectedDate(tempSelectedDate);
    setEndDate(tempEndDate);
    setSelectedMonth(tempSelectedMonth);
    setSelectedYearGrid(tempSelectedYearGrid);
    onChangeDate(pickerMode === W ? tempSelectedDate : tempSelectedDate);
    setModalVisible(false);
  };

  /**
   * Handles the day press event in the calendar
   * @param day - The selected day object from the calendar
   */
  const handleDayPress = (day: any) => {
    if (pickerMode === W) {
      handleWeekDayPress(day);
    } else {
      setTempSelectedDate(day.dateString);
    }
  };

  /**
   * Handles the week day press event specifically
   * @param day - The selected day object from the calendar
   */
  const handleWeekDayPress = (day: any) => {
    const clickedDate = new Date(day.dateString);

    if (day.dateString === tempSelectedDate) {
      setTempSelectedDate('');
      return;
    }
    if (day.dateString === tempEndDate) {
      setTempEndDate('');
      return;
    }

    if (!tempSelectedDate) {
      setTempSelectedDate(day.dateString);
    } else {
      const startDate = new Date(tempSelectedDate);
      if (clickedDate < startDate) {
        setTempEndDate(tempSelectedDate);
        setTempSelectedDate(day.dateString);
      } else {
        setTempEndDate(day.dateString);
      }
    }
  };

  /**
   * Gets the marked dates for the calendar
   * @returns Object containing marked dates configuration
   */
  const getMarkedDates = (): MarkedDates => {
    if (pickerMode === W) {
      return getWeekMarkedDates();
    }

    return {
      [tempSelectedDate]: {
        selected: true,
        color: colors.azureBlue,
      },
    };
  };

  /**
   * Gets the marked dates specifically for week mode
   * @returns Object containing marked dates configuration for week mode
   */
  const getWeekMarkedDates = (): MarkedDates => {
    const markedDates: MarkedDates = {};

    if (tempSelectedDate && tempEndDate) {
      const start = new Date(tempSelectedDate);
      const end = new Date(tempEndDate);
      const current = new Date(start);

      while (current <= end) {
        const dateString = current.toISOString().split('T')[0];
        markedDates[dateString] = {
          color:
            dateString === tempSelectedDate || dateString === tempEndDate
              ? colors.azureBlue
              : colors.lightBlue3,
          startingDay: dateString === tempSelectedDate,
          endingDay: dateString === tempEndDate,
        };
        current.setDate(current.getDate() + 1);
      }
    } else if (tempSelectedDate) {
      markedDates[tempSelectedDate] = {
        color: colors.azureBlue,
        startingDay: true,
        selected: true,
      };
    } else if (tempEndDate) {
      markedDates[endDate] = {
        color: colors.azureBlue,
        endingDay: true,
        selected: true,
      };
    }
    return markedDates;
  };

  /**
   * Opens the date picker modal
   */
  const openDatePicker = () => {
    setTempSelectedDate(selectedDate);
    setTempEndDate(endDate);
    setTempSelectedMonth(selectedMonth);
    setTempSelectedYearGrid(selectedYearGrid);
    setModalVisible(true);
  };

  /**
   * Renders the month selection grid
   */
  const renderMonthGrid = () => (
    <View style={styles.monthGridContainer}>
      <Text style={styles.modalTitle}>
        {t('analytics.dateSelector.selectMonth')}
      </Text>
      <View style={styles.monthGrid}>
        {MONTHS.map((m, idx) => (
          <TouchableOpacity
            key={m}
            style={[
              styles.monthCell,
              tempSelectedMonth === idx && styles.monthCellSelected,
            ]}
            onPress={() => setTempSelectedMonth(idx)}>
            <Text
              style={[
                styles.monthCellText,
                tempSelectedMonth === idx && styles.monthCellTextSelected,
              ]}>
              {m}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.yearRow}>
        <TouchableOpacity onPress={() => setTempSelectedYearGrid(y => y - 1)}>
          <LeftArrow width={12} height={12} />
        </TouchableOpacity>
        <Text style={styles.yearText}>{tempSelectedYearGrid}</Text>
        <TouchableOpacity onPress={() => setTempSelectedYearGrid(y => y + 1)}>
          <RightArrow width={12} height={12} />
        </TouchableOpacity>
      </View>
    </View>
  );

  /**
   * Renders the year selection grid
   */
  const renderYearGrid = () => (
    <View style={styles.yearGridContainer}>
      <Text style={styles.modalTitle}>
        {t('analytics.dateSelector.selectYear')}
      </Text>
      <View style={styles.yearGrid}>
        {YEARS.map(y => (
          <TouchableOpacity
            key={y}
            style={[
              styles.yearCell,
              tempSelectedYearGrid === y && styles.yearCellSelected,
            ]}
            onPress={() => setTempSelectedYearGrid(y)}>
            <Text
              style={[
                styles.yearCellText,
                tempSelectedYearGrid === y && styles.yearCellTextSelected,
              ]}>
              {y}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  /**
   * Renders the date picker modal
   */
  const renderPickerModal = () => (
    <Modal
      visible={modalVisible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalContent}>
          {(pickerMode === W || pickerMode === D) && (
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {t('analytics.dateSelector.selectDate')}
              </Text>
              <Calendar
                markingType={pickerMode === W ? 'period' : 'dot'}
                current={tempSelectedDate}
                onDayPress={handleDayPress}
                markedDates={getMarkedDates()}
                theme={{
                  calendarBackground: colors.white,
                  textSectionTitleColor: colors.darkSlate,
                  selectedDayBackgroundColor: colors.azureBlue,
                  selectedDayTextColor: colors.white,
                  todayTextColor: colors.azureBlue,
                  dayTextColor: colors.darkSlate,
                  textDisabledColor: colors.lightGray4,
                  arrowColor: colors.azureBlue,
                }}
                style={styles.calendarContainer}
              />
            </View>
          )}
          {pickerMode === M && renderMonthGrid()}
          {pickerMode === Y && renderYearGrid()}
          <View style={styles.modalActions}>
            <TouchableOpacity onPress={handleCancel}>
              <Text style={styles.modalCancel}>
                {t('analytics.modal.cancel')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleOk}>
              <Text style={styles.modalOk}>{t('analytics.modal.ok')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  /**
   * Gets the display text based on the picker mode
   */
  const getDisplayText = () => {
    switch (pickerMode) {
      case D:
        return selectedDate;
      case W:
        return `${selectedDate} - ${endDate}`;
      case M:
        return `${MONTHS[selectedMonth]} ${selectedYearGrid}`;
      case Y:
        return selectedYearGrid;
      default:
        return '';
    }
  };

  return (
    <>
      {renderPickerModal()}
      <View style={styles.dateSelector}>
        <TouchableOpacity style={styles.arrowContainer}>
          <LeftArrow width={12} height={12} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openDatePicker} style={styles.monthSelector}>
          <Text style={styles.monthText}>{getDisplayText()}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.arrowContainer}>
          <RightArrow width={12} height={12} />
        </TouchableOpacity>
      </View>
    </>
  );
};

const styles = ScaledSheet.create({
  dateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2@s',
    width: '100%',
    marginBottom: '18@s',
  },
  arrowContainer: {
    width: '30@s',
    height: '30@s',
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12@s',
    borderWidth: 1,
    borderColor: colors.lightGray7,
    borderRadius: '8@s',
    paddingHorizontal: '24@s',
    paddingVertical: '8@s',
    backgroundColor: colors.white,
  },
  monthText: {
    fontSize: '14@s',
    fontWeight: '500',
    color: colors.darkSlate,
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    backgroundColor: colors.white,
    borderRadius: '10@ms',
    alignItems: 'center',
    marginBottom: '50@ms',
  },
  modalHeader: {
    padding: '20@ms',
    width: '100%',
  },
  modalTitle: {
    fontSize: '15@s',
    fontFamily: fontFamily.ROBOTO.REGULAR.fontFamily,
    fontWeight: '900',
    color: colors.darkSlate,
    marginBottom: '12@s',
    width: '100%',
    textAlign: 'left',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    width: '100%',
    gap: '24@s',
    padding: '16@ms',
    paddingVertical: '20@ms',
    borderTopColor: colors.lightGray,
    borderTopWidth: 1,
  },
  modalCancel: {
    fontSize: '14@s',
    color: colors.black,
    fontWeight: '500',
  },
  modalOk: {
    fontSize: '14@s',
    color: colors.azureBlue,
    fontWeight: '500',
  },
  monthGridContainer: {
    width: '100%',
    alignItems: 'center',
    padding: '20@ms',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginBottom: '12@s',
    gap: '8@s',
    width: '100%',
  },
  monthCell: {
    width: '60@s',
    height: '30@s',
    borderRadius: '18@s',
    justifyContent: 'center',
    alignItems: 'center',
    margin: '4@s',
    backgroundColor: colors.white,
  },
  monthCellSelected: {
    backgroundColor: colors.azureBlue,
  },
  monthCellText: {
    fontSize: '14@s',
    color: colors.darkSlate,
    fontFamily: fontFamily.ROBOTO.REGULAR.fontFamily,
  },
  monthCellTextSelected: {
    color: colors.white,
    fontWeight: 'bold',
  },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '8@s',
    gap: '16@s',
  },
  yearText: {
    fontSize: '18@s',
    color: colors.darkSlate,
    fontFamily: fontFamily.ROBOTO.REGULAR.fontFamily,
    fontWeight: '500',
    marginHorizontal: '6@s',
  },
  yearGridContainer: {
    width: '100%',
    alignItems: 'center',
    padding: '20@ms',
  },
  yearGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginBottom: '12@s',
    gap: '5@s',
    width: '100%',
  },
  yearCell: {
    width: '70@s',
    height: '30@s',
    borderRadius: '18@s',
    justifyContent: 'center',
    alignItems: 'center',
    margin: '4@s',
    backgroundColor: colors.white,
  },
  yearCellSelected: {
    backgroundColor: colors.azureBlue,
  },
  yearCellText: {
    fontSize: '14@s',
    fontFamily: fontFamily.ROBOTO.REGULAR.fontFamily,
    color: colors.darkSlate,
  },
  yearCellTextSelected: {
    color: colors.white,
    fontWeight: 'bold',
  },
  calendarContainer: {
    marginBottom: '12@s',
  },
});

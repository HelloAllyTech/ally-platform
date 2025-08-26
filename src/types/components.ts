/**
 * Props for the DateSelector component
 */
export interface DateSelectorProps {
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
export interface MarkedDates {
  [key: string]: {
    color: string;
    startingDay?: boolean;
    endingDay?: boolean;
    selected?: boolean;
  };
}

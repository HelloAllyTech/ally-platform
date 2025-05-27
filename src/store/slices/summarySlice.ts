import {createSlice, PayloadAction} from '@reduxjs/toolkit';

import {CallSummaryResponse} from '@/services/callSummaryApi';

interface SummaryState {
  summaryData: CallSummaryResponse | null;
}

const initialState: SummaryState = {
  summaryData: null,
};

const summarySlice = createSlice({
  name: 'summary',
  initialState,
  reducers: {
    setSummaryData: (state, action: PayloadAction<CallSummaryResponse>) => {
      state.summaryData = action.payload;
    },
    clearSummary: state => {
      state.summaryData = null;
    },
  },
});

export const {setSummaryData, clearSummary} = summarySlice.actions;

export default summarySlice.reducer;

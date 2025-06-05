import {createSlice, PayloadAction} from '@reduxjs/toolkit';

import {CallSummaryResponse} from '@/services/callSummaryApi';
import {FormData} from '@/utils/callSummary/formDataTransformer';

interface SummaryState {
  summaryData: CallSummaryResponse | null;
  formData: FormData | null;
}

const initialState: SummaryState = {
  summaryData: null,
  formData: null,
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
    setFormData: (state, action: PayloadAction<Partial<FormData>>) => {
      state.formData = {
        ...state.formData,
        ...action.payload,
      } as FormData;
    },
    clearFormData: state => {
      state.formData = null;
    },
  },
});

export const {setSummaryData, clearSummary, setFormData, clearFormData} =
  summarySlice.actions;

export default summarySlice.reducer;

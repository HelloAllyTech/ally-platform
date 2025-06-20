import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';

import {CallSummaryResponse} from '@/services/callSummaryApi';
import {AppRootState} from '@/store/store';
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

// Summary API response
export const selectSummaryData = (state: AppRootState) =>
  state.summary.summaryData;
export const selectFormData = (state: AppRootState) => state.summary.formData;

export const selectSummary = createSelector(
  [selectSummaryData],
  summaryData => summaryData?.details?.summary,
);

export const selectCallDetails = createSelector(
  [selectSummaryData],
  summaryData => ({
    ...summaryData?.details,
    clientId: summaryData?.clientId,
  }),
);

export const selectCallInfo = createSelector(
  [selectSummaryData],
  summaryData => ({
    chatId: summaryData?.details?.chatId,
    callDuration: summaryData?.details?.callDuration,
    startTime: summaryData?.details?.startTime,
    endTime: summaryData?.details?.endTime,
    clientId: summaryData?.clientId,
    summaryName: summaryData?.details?.callInfo?.summaryName,
  }),
);

export const selectMetrics = createSelector(
  [selectSummaryData],
  summaryData => ({
    listeningShare:
      summaryData?.details?.callInfo?.counselorTalkingPercentage ?? null,
    reflectiveQuestionsAsked:
      summaryData?.details?.summary?.reflectiveQuestionsAsked ?? null,
    emotionalLift: summaryData?.details?.summary?.emotionalLift ?? null,
  }),
);

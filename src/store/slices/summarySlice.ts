import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';

import {SummaryFieldKey} from '@/constants/summary';
import {CallSummaryResponse} from '@/services/callSummaryApi';
import {AppRootState} from '@/store/store';
import {SummaryFormData} from '@/types';

interface SummaryState {
  summaryData: CallSummaryResponse | null;
  formData: SummaryFormData | null;
  visibleFields: SummaryFieldKey[];
}

const initialState: SummaryState = {
  summaryData: null,
  formData: null,
  visibleFields: [],
};

const summarySlice = createSlice({
  name: 'summary',
  initialState,
  reducers: {
    setSummaryData: (state, action: PayloadAction<CallSummaryResponse>) => {
      state.summaryData = action.payload;
    },
    setFormData: (state, action: PayloadAction<Partial<SummaryFormData>>) => {
      state.formData = {
        ...state.formData,
        ...action.payload,
      } as SummaryFormData;
    },
    setSummaryVisibleFields: (
      state,
      action: PayloadAction<SummaryFieldKey[]>,
    ) => {
      state.visibleFields = action.payload;
    },
    clearSummaryStates: state => {
      state.summaryData = null;
      state.formData = null;
    },
  },
});

export const {
  setSummaryData,
  setFormData,
  clearSummaryStates,
  setSummaryVisibleFields,
} = summarySlice.actions;

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
    counselorId: summaryData?.counselorId,
    callDuration: summaryData?.details?.callDuration,
    startTime: summaryData?.details?.startTime,
    endTime: summaryData?.details?.endTime,
    clientId: summaryData?.clientId,
    summaryName: summaryData?.details?.callInfo?.summaryName,
    provider: summaryData?.details?.callInfo?.provider,
    mode: summaryData?.details?.callInfo?.mode,
  }),
);

export const selectMetrics = createSelector(
  [selectSummaryData],
  summaryData => ({
    listeningShare:
      summaryData?.details?.callInfo?.clientTalkingPercentage ?? null,
    reflectiveQuestionsAsked:
      summaryData?.details?.summary?.reflectiveQuestionsAsked ?? null,
    emotionalLift: summaryData?.details?.summary?.emotionalLift ?? null,
  }),
);

export const selectSummaryVisibleFields = (state: AppRootState) =>
  state.summary.visibleFields;

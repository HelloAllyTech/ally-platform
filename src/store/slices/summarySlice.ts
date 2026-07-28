import {createSelector, createSlice, PayloadAction} from '@reduxjs/toolkit';

import {SummaryFieldKey} from '@/constants/summary';
import {CallSummaryResponse} from '@/services/callSummaryApi';
import {AppRootState} from '@/store/store';
import {SummaryFormData} from '@/types';

interface SummaryState {
  summaryData: CallSummaryResponse | null;
  formData: SummaryFormData | null;
  /**
   * The last values known to be on the server: what the form was seeded with,
   * plus anything since written successfully. Everything that differs from this
   * is an unsaved edit.
   *
   * It lives in the store rather than a ref because useCallSummaryForm is
   * instantiated in several places (the screen, the details pane, every section
   * wrapper). A per-instance baseline meant each copy had its own idea of what
   * had changed, and the instance that saves is not the one that took the edit.
   */
  savedFormData: SummaryFormData | null;
  visibleFields: SummaryFieldKey[];
}

const initialState: SummaryState = {
  summaryData: null,
  formData: null,
  savedFormData: null,
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
    /**
     * Record values as persisted. Merged, not replaced: an edit made while the
     * write was in flight must stay dirty, so only the keys actually written
     * are marked clean.
     */
    markFormDataSaved: (
      state,
      action: PayloadAction<Partial<SummaryFormData>>,
    ) => {
      state.savedFormData = {
        ...state.savedFormData,
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
      state.savedFormData = null;
    },
  },
});

export const {
  setSummaryData,
  setFormData,
  markFormDataSaved,
  clearSummaryStates,
  setSummaryVisibleFields,
} = summarySlice.actions;

export default summarySlice.reducer;

// Summary API response
export const selectSummaryData = (state: AppRootState) =>
  state.summary.summaryData;
export const selectFormData = (state: AppRootState) => state.summary.formData;
export const selectSavedFormData = (state: AppRootState) =>
  state.summary.savedFormData;

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

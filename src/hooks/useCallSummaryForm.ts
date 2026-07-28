import {useCallback, useEffect, useRef} from 'react';

import {
  ChatSummaryStatus,
  SectionKey,
  SUMMARY_FIELDS,
  SummaryFieldKey,
  summaryFields,
} from '@/constants/summary';
import {
  getChangedSummaryFieldKeys,
  transformFormDataForSubmission,
  transformSummaryToFormData,
} from '@/screens/CallSummaryScreen/utils/formDataTransformer';
import {
  SummaryDetails,
  useUpdateCallSummaryMutation,
} from '@/services/callSummaryApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {
  selectFormData,
  selectSummary,
  selectSummaryData,
  setFormData,
} from '@/store/slices/summarySlice';
import {SummaryFormData} from '@/types';
import {mapTagsToString} from '@/utils/callSummary';

export const useCallSummaryForm = () => {
  const dispatch = useAppDispatch();
  const originalFormDataRef = useRef<SummaryFormData | null>(null);

  const summaryData = useAppSelector(selectSummaryData);
  const formData = useAppSelector(selectFormData);
  const summary = useAppSelector(selectSummary);

  const [updateCallSummary, {isLoading: isUpdating}] =
    useUpdateCallSummaryMutation();

  // A manual scribe note has summaryStatus SUCCESS but no AI summary yet; its
  // form must still be seeded (with empty values) so the fields are editable.
  const isManualNote =
    summaryData?.summaryStatus === ChatSummaryStatus.SUCCESS && !summary;

  useEffect(() => {
    if (summary || isManualNote) {
      const transformedData = transformSummaryToFormData(
        summary ?? ({} as SummaryDetails),
        summaryData?.details?.callInfo,
      );
      dispatch(setFormData(transformedData));
      // Store the original form data for comparison
      originalFormDataRef.current = transformedData;
    }
  }, [dispatch, summary, isManualNote, summaryData?.details?.callInfo]);

  const handleFieldChange =
    (field: SummaryFieldKey) => (value: string | null) => {
      dispatch(
        setFormData({
          [field]: value,
        }),
      );
    };

  const handleSectionFieldsReset = (sectionKey: SectionKey) => {
    if (!summary) return;
    const sectionFields = summaryFields.filter(
      field => field.sectionKey === sectionKey && field.isEditable,
    );
    const sectionData = sectionFields.reduce((acc, field) => {
      if (field.key === SUMMARY_FIELDS.TAGS) {
        acc[field.key] = mapTagsToString(summary?.tags || []) || null;
        return acc;
      }
      if (field.key in summary) {
        (acc as any)[field.key] = summary[field.key] ?? null;
      }
      return acc;
    }, {} as Partial<SummaryFormData>);

    dispatch(setFormData(sectionData));
  };

  const handleSubmit = async () => {
    if (!summaryData) return;

    const changedKeys = getChangedSummaryFieldKeys(
      originalFormDataRef.current,
      formData,
    );
    if (changedKeys.length === 0) return;

    // Tag names go as typed; the backend keeps whatever rating each tag already
    // had and starts new ones neutral. Nothing here calls the ratings LLM: it
    // used to run before the write, so a slow AI service stalled the save, and
    // on failure the payload fell back to the *stored* tags — silently throwing
    // away what the counsellor had just typed.
    const tagNames = changedKeys.includes(SUMMARY_FIELDS.TAGS)
      ? String(formData?.[SUMMARY_FIELDS.TAGS] ?? '')
          .split(',')
          .map(tag => tag.trim())
          .filter(Boolean)
      : undefined;

    const summaryPatch = transformFormDataForSubmission(
      formData,
      changedKeys,
      tagNames,
    );
    const result = await updateCallSummary({
      chatId: summaryData.id,
      data: {
        summary: summaryPatch,
      },
    });
    // The saved values are the new baseline, so a second save doesn't re-send
    // fields that are already persisted.
    if (!('error' in result)) {
      originalFormDataRef.current = formData;
    }
    return result;
  };

  // Same comparison the patch is built from, so the Save affordance and the
  // payload can never disagree about what counts as a change.
  const hasChanges = useCallback(
    () =>
      getChangedSummaryFieldKeys(originalFormDataRef.current, formData).length >
      0,
    [formData],
  );

  return {
    formData,
    isUpdating,
    handleFieldChange,
    handleSubmit,
    handleSectionFieldsReset,
    hasChanges: hasChanges(),
  };
};

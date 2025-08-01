import {useCallback, useEffect, useRef} from 'react';

import {
  SectionKey,
  SUMMARY_FIELDS,
  SummaryFieldKey,
  summaryFields,
} from '@/constants/summary';
import {
  useGetTagsMutation,
  useUpdateCallSummaryMutation,
} from '@/services/callSummaryApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {
  selectFormData,
  selectSummary,
  selectSummaryData,
  setFormData,
} from '@/store/slices/summarySlice';
import {mapTagsToString} from '@/utils/callSummary';
import {
  FormData,
  transformFormDataForSubmission,
  transformSummaryToFormData,
} from '@/utils/callSummary/formDataTransformer';

export const useCallSummaryForm = () => {
  const dispatch = useAppDispatch();
  const originalFormDataRef = useRef<FormData | null>(null);

  const summaryData = useAppSelector(selectSummaryData);
  const formData = useAppSelector(selectFormData);
  const summary = useAppSelector(selectSummary);

  const [updateCallSummary, {isLoading: isUpdating}] =
    useUpdateCallSummaryMutation();
  const [getTags] = useGetTagsMutation();

  useEffect(() => {
    if (summary) {
      const transformedData = transformSummaryToFormData(
        summary,
        summaryData?.details?.callInfo,
      );
      dispatch(setFormData(transformedData));
      // Store the original form data for comparison
      originalFormDataRef.current = transformedData;
    }
  }, [dispatch, summary, summaryData?.details?.callInfo]);

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
    }, {} as Partial<FormData>);

    dispatch(setFormData(sectionData));
  };

  const handleSubmit = async () => {
    if (!summaryData) return;
    let tagsResponse;
    if (
      formData?.[SUMMARY_FIELDS.TAGS] &&
      formData?.[SUMMARY_FIELDS.TAGS] !==
        mapTagsToString(summaryData?.details?.summary?.tags || [])
    ) {
      tagsResponse = await getTags({
        tags: (formData[SUMMARY_FIELDS.TAGS] as string)?.split(',') || [],
      });
    }
    const formattedFormData = transformFormDataForSubmission(
      formData,
      summaryData,
      tagsResponse?.data || summary?.tags || [],
    );
    return await updateCallSummary({
      chatId: summaryData.id,
      data: {
        summary: formattedFormData,
      },
    });
  };

  // Check if form data has been modified
  const hasChanges = useCallback(() => {
    if (!originalFormDataRef.current || !formData) return false;

    const original = originalFormDataRef.current;
    const current = formData;

    // Compare all fields in the form data
    return Object.keys(current).some(key => {
      const fieldKey = key as keyof FormData;
      return original[fieldKey] !== current[fieldKey];
    });
  }, [formData]);

  return {
    formData,
    isUpdating,
    handleFieldChange,
    handleSubmit,
    handleSectionFieldsReset,
    hasChanges: hasChanges(),
  };
};

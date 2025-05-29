import {useEffect} from 'react';

import {SectionKey, SummaryFieldKey, summaryFields} from '@/constants/summary';
import {useUpdateCallSummaryMutation} from '@/services/callSummaryApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {setFormData} from '@/store/slices/summarySlice';
import {SummaryFieldValueTypes} from '@/types/callSummary';
import {
  transformFormDataForSubmission,
  transformSummaryToFormData,
} from '@/utils/callSummary/formDataTransformer';

export const useCallSummaryForm = () => {
  const dispatch = useAppDispatch();
  const summaryData = useAppSelector(state => state.summary.summaryData);
  const formData = useAppSelector(state => state.summary.formData);
  const [updateCallSummary, {isLoading: isUpdating}] =
    useUpdateCallSummaryMutation();
  const summary = summaryData?.details?.summary;

  useEffect(() => {
    if (summary) {
      dispatch(setFormData(transformSummaryToFormData(summary)));
    }
  }, [dispatch, summary]);

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
      field => field.sectionKey === sectionKey,
    );
    const sectionData = sectionFields.reduce(
      (acc, field) => {
        acc[field.key] = summary[field.key] ?? null;
        return acc;
      },
      {} as Record<SummaryFieldKey, SummaryFieldValueTypes | null>,
    );

    dispatch(setFormData(sectionData));
  };

  const handleSubmit = async () => {
    if (!formData || !summaryData) return;
    const formattedFormData = transformFormDataForSubmission(
      formData,
      summaryData,
    );
    return await updateCallSummary({
      chatId: summaryData.id,
      data: {
        summary: formattedFormData,
      },
    });
  };

  return {
    formData,
    isUpdating,
    handleFieldChange,
    handleSubmit,
    handleSectionFieldsReset,
  };
};

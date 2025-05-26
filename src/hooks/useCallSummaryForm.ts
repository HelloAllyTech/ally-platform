import {useEffect, useState} from 'react';

import {SummaryFieldKey} from '@/constants/summary';
import {
  CallSummaryResponse,
  useUpdateCallSummaryMutation,
} from '@/services/callSummaryApi';
import {
  FormData,
  getInitialFormData,
  transformFormDataForSubmission,
  transformSummaryToFormData,
} from '@/utils/callSummary/formDataTransformer';

interface UseCallSummaryFormProps {
  summaryData: CallSummaryResponse;
}

export const useCallSummaryForm = ({summaryData}: UseCallSummaryFormProps) => {
  const [formData, setFormData] = useState<FormData>(getInitialFormData());
  const [updateCallSummary, {isLoading: isUpdating}] =
    useUpdateCallSummaryMutation();
  const summary = summaryData?.details?.summary;

  useEffect(() => {
    if (summary) {
      setFormData(transformSummaryToFormData(summary));
    }
  }, [summary]);

  const handleFieldChange = (field: SummaryFieldKey) => (value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async () => {
    const formattedFormData = transformFormDataForSubmission(
      formData,
      summaryData,
    );
    return await updateCallSummary({
      chatId: summaryData.id,
      data: {
        callDetails: formattedFormData,
      },
    });
  };

  return {
    formData,
    isUpdating,
    handleFieldChange,
    handleSubmit,
  };
};

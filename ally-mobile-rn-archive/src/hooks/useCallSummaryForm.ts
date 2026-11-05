import {useEffect, useRef} from 'react';

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
  markFormDataSaved,
  selectFormData,
  selectSavedFormData,
  selectSummary,
  selectSummaryData,
  setFormData,
} from '@/store/slices/summarySlice';
import {SummaryFormData} from '@/types';
import {mapTagsToString} from '@/utils/callSummary';

export const useCallSummaryForm = () => {
  const dispatch = useAppDispatch();

  const summaryData = useAppSelector(selectSummaryData);
  const formData = useAppSelector(selectFormData);
  const savedFormData = useAppSelector(selectSavedFormData);
  const summary = useAppSelector(selectSummary);

  const [updateCallSummary, {isLoading: isUpdating}] =
    useUpdateCallSummaryMutation();

  // A manual scribe note has summaryStatus SUCCESS but no AI summary yet; its
  // form must still be seeded (with empty values) so the fields are editable.
  const isManualNote =
    summaryData?.summaryStatus === ChatSummaryStatus.SUCCESS && !summary;

  // The session this form currently holds. Seeding is keyed on it, so opening a
  // different session always reseeds while a refetch of the *same* session does
  // not throw away what the counsellor is typing.
  const seededChatIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!summary && !isManualNote) return;

    const seeded = transformSummaryToFormData(
      summary ?? ({} as SummaryDetails),
      summaryData?.details?.callInfo,
    );
    const chatId = summaryData?.id ?? null;
    const isNewSession = seededChatIdRef.current !== chatId;

    // Unsaved edits win over the incoming server copy. This effect re-runs on
    // every `summary` identity change — any refetch, an async AI fill, a
    // regeneration landing — and it used to dispatch the server values
    // wholesale, wiping whatever was typed AND resetting the baseline, so the
    // loss wasn't even detectable as an unsaved change afterwards.
    const unsaved = isNewSession
      ? {}
      : (Object.fromEntries(
          getChangedSummaryFieldKeys(savedFormData, formData).map(key => [
            key,
            formData?.[key],
          ]),
        ) as Partial<SummaryFormData>);

    dispatch(setFormData({...seeded, ...unsaved}));
    // The baseline is always the server copy, so anything preserved above stays
    // correctly marked as unsaved.
    dispatch(markFormDataSaved(seeded));
    seededChatIdRef.current = chatId;
    // formData/savedFormData are read only to carry edits across a reseed; they
    // must not retrigger it, or this would fire on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, summary, isManualNote, summaryData?.id]);

  const handleFieldChange =
    (field: SummaryFieldKey) => (value: string | null) => {
      dispatch(setFormData({[field]: value}));
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
        acc[field.key] =
          (summary[field.key as keyof SummaryDetails] as string) ?? null;
      }
      return acc;
    }, {} as Partial<SummaryFormData>);

    dispatch(setFormData(sectionData));
  };

  const handleSubmit = async () => {
    if (!summaryData) return;

    const changedKeys = getChangedSummaryFieldKeys(savedFormData, formData);
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

    if (!('error' in result)) {
      // Mark only what was written. Merging (rather than replacing the whole
      // baseline) keeps an edit made during the request dirty, so it still gets
      // saved by the next submit.
      dispatch(
        markFormDataSaved(
          Object.fromEntries(
            changedKeys.map(key => [key, formData?.[key]]),
          ) as Partial<SummaryFormData>,
        ),
      );
    }
    return result;
  };

  // Shared baseline, so every instance of this hook — and the payload itself —
  // agree on what counts as an unsaved change.
  const hasChanges =
    getChangedSummaryFieldKeys(savedFormData, formData).length > 0;

  return {
    formData,
    isUpdating,
    handleFieldChange,
    handleSubmit,
    handleSectionFieldsReset,
    hasChanges,
  };
};

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Text, TouchableOpacity} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {MicIcon} from '@/assets/icons';
import {useToast} from '@/components';
import {
  ALWAYS_VISIBLE_SECTIONS,
  SUMMARY_FIELDS,
  SummaryFieldKey,
  summaryFields,
  USER_PERMISSIONS,
} from '@/constants';
import {
  useScribeVoiceNoteEnabled,
  useTranslate,
  useVoiceNoteRecorder,
} from '@/hooks';
import {transformFormDataForSubmission} from '@/screens/CallSummaryScreen/utils/formDataTransformer';
import {useUpdateCallSummaryMutation} from '@/services/callSummaryApi';
import {
  CustomFieldDefinition,
  CustomFieldEditPermission,
  CustomFieldType,
  useGetCustomFieldDefinitionsQuery,
  useGetCustomFieldsEnabledQuery,
  useUpsertCustomFieldValuesMutation,
} from '@/services/customFieldsApi';
import {
  useGenerateNoteFromAudioMutation,
  useSaveNoteTranscriptMutation,
  VoiceNoteFieldSpec,
  VoiceNoteFieldType,
} from '@/services/scribeNoteApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {
  selectFormData,
  selectSummaryData,
  selectSummaryVisibleFields,
  setFormData,
} from '@/store/slices/summarySlice';
import {colors, typography} from '@/theme';
import {SummaryFormData} from '@/types';
import {FieldType} from '@/types/fields';
import {spokenDateToCustomFieldDate} from '@/utils/customFieldDate';

import {VoiceNotePanel} from './VoiceNotePanel';

interface VoiceNoteSectionProps {
  chatId?: number;
  /**
   * Called after dictation writes custom-field values server-side, so the
   * parent can remount CallSummaryDetails and re-seed from the fresh values.
   */
  onCustomValuesApplied: () => void;
}

const mapBuiltinType = (type: FieldType): VoiceNoteFieldType => {
  if (type === FieldType.Dropdown || type === FieldType.SearchableDropdown) {
    return 'select';
  }
  if (type === FieldType.MultilineTextInput) return 'multiline';
  return 'text';
};

const mapCustomType = (type: CustomFieldType): VoiceNoteFieldType => {
  switch (type) {
    case CustomFieldType.SINGLE_SELECT:
      return 'select';
    case CustomFieldType.MULTI_SELECT:
      return 'multiselect';
    case CustomFieldType.NUMBER:
      return 'number';
    case CustomFieldType.BOOLEAN:
      return 'boolean';
    case CustomFieldType.DATE:
      return 'date';
    default:
      return 'text';
  }
};

/**
 * Convert an LLM value (always a human-readable string) into the encoding the
 * mobile custom-field editors store (see CustomFieldsSection): single-select →
 * the canonical option label, multi-select → JSON array of labels, boolean →
 * "true"/"false", date → YYYY-MM-DD. Returns null when the value can't be
 * mapped (e.g. an option no longer exists), so nothing invalid is written.
 */
export const encodeVoiceCustomValue = (
  def: CustomFieldDefinition,
  value: string,
): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  switch (def.fieldType) {
    case CustomFieldType.SINGLE_SELECT: {
      const option = def.options?.find(
        o => o.label.toLowerCase() === trimmed.toLowerCase(),
      );
      return option ? option.label : null;
    }
    case CustomFieldType.MULTI_SELECT: {
      // The backend sends matched labels as a JSON array (comma-safe); fall
      // back to comma-splitting if it isn't valid JSON.
      let labels: string[];
      try {
        const parsed = JSON.parse(trimmed);
        labels = Array.isArray(parsed) ? parsed.map(String) : [trimmed];
      } catch {
        labels = trimmed.split(',');
      }
      const wanted = labels.map(s => s.trim().toLowerCase()).filter(Boolean);
      const matched = (def.options ?? [])
        .filter(o => wanted.includes(o.label.toLowerCase()))
        .map(o => o.label);
      return matched.length ? JSON.stringify(matched) : null;
    }
    case CustomFieldType.BOOLEAN: {
      const v = trimmed.toLowerCase();
      if (['yes', 'true', 'y'].includes(v)) return 'true';
      if (['no', 'false', 'n'].includes(v)) return 'false';
      return null;
    }
    case CustomFieldType.DATE:
      // Encoding this via `toISOString()` converted a locally-parsed date to
      // UTC and rolled the day back one in IST.
      return spokenDateToCustomFieldDate(trimmed);
    default:
      return trimmed;
  }
};

/**
 * Voice-dictation entry point for manual scribe notes: records a dictation,
 * sends it to the generate-from-audio endpoint together with the note's field
 * structure, writes the extracted values into the form (built-in summary
 * fields via redux + call-details save, custom fields via the custom-field
 * endpoint), and saves the accumulated transcript to the note so it shows in
 * the Transcript tab. The audio itself is processed in memory server-side and
 * never persisted.
 */
export const VoiceNoteSection: React.FC<VoiceNoteSectionProps> = ({
  chatId,
  onCustomValuesApplied,
}) => {
  const {t} = useTranslate();
  const {showToast} = useToast();
  const dispatch = useAppDispatch();
  const permissions = useAppSelector(state => state.user.permissions);
  const visibleFields = useAppSelector(selectSummaryVisibleFields);
  const formData = useAppSelector(selectFormData);
  const summaryData = useAppSelector(selectSummaryData);

  const isCounsellor = Boolean(
    permissions?.includes(USER_PERMISSIONS.COUNSELOR_ACCESS),
  );
  const isAdmin = Boolean(
    permissions?.includes(USER_PERMISSIONS.MANAGE_CUSTOM_FIELD_DEFINITIONS),
  );

  // Voice is offered only when the tenant has enabled it (super-admin /
  // org-admin toggle, default OFF). The hook skips its request for
  // non-counsellors, matching the web CreateNoteDrawer gate.
  const {data: voiceNoteEnabled} = useScribeVoiceNoteEnabled();
  const isVoiceEnabled = Boolean(voiceNoteEnabled);

  const {data: customFieldsEnabled} = useGetCustomFieldsEnabledQuery(
    undefined,
    {skip: !isVoiceEnabled},
  );
  const {data: customFieldDefs} = useGetCustomFieldDefinitionsQuery(undefined, {
    skip: !isVoiceEnabled || customFieldsEnabled === false,
  });

  const [generateNoteFromAudio] = useGenerateNoteFromAudioMutation();
  const [saveNoteTranscript] = useSaveNoteTranscriptMutation();
  const [updateCallSummary] = useUpdateCallSummaryMutation();
  const [upsertCustomFieldValues] = useUpsertCustomFieldValuesMutation();

  const recorder = useVoiceNoteRecorder();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  // Accumulates the dictation transcript across recordings within this note
  // session; the full text is re-sent on every save (the endpoint replaces the
  // stored transcript).
  const transcriptRef = useRef('');

  // Seed from a previously saved dictation so re-dictating on a later visit
  // appends to the stored transcript instead of replacing it.
  const existingTranscript = summaryData?.details?.transcript;
  useEffect(() => {
    if (existingTranscript && !transcriptRef.current) {
      transcriptRef.current = existingTranscript;
    }
  }, [existingTranscript]);

  // The set of fields voice dictation can fill — visible editable built-in
  // summary fields plus the org's custom fields the user may edit.
  const {voiceFields, builtinKeys, customDefsById} = useMemo(() => {
    const fields: VoiceNoteFieldSpec[] = [];
    const builtins = new Set<string>();
    const customs = new Map<string, CustomFieldDefinition>();

    for (const field of summaryFields) {
      if (!field.isEditable) continue;
      const isVisible =
        ALWAYS_VISIBLE_SECTIONS.includes(field.sectionKey) ||
        !visibleFields ||
        visibleFields.length === 0 ||
        visibleFields.includes(field.key);
      if (!isVisible) continue;
      fields.push({
        id: field.key,
        label: field.label,
        type: mapBuiltinType(field.type),
        options: field.options?.length ? [...field.options] : undefined,
        hint: field.placeholder,
      });
      builtins.add(field.key);
    }

    for (const def of customFieldDefs ?? []) {
      const canEdit =
        def.editPermission === CustomFieldEditPermission.BOTH ||
        (def.editPermission === CustomFieldEditPermission.ADMIN_ONLY &&
          isAdmin) ||
        (def.editPermission === CustomFieldEditPermission.COUNSELLOR_ONLY &&
          isCounsellor);
      if (!canEdit) continue;
      const options =
        def.fieldType === CustomFieldType.BOOLEAN
          ? ['Yes', 'No']
          : def.options?.length
            ? def.options.map(o => o.label)
            : undefined;
      fields.push({
        id: def.id,
        label: def.name,
        type: mapCustomType(def.fieldType),
        options,
      });
      customs.set(def.id, def);
    }

    return {
      voiceFields: fields,
      builtinKeys: builtins,
      customDefsById: customs,
    };
  }, [visibleFields, customFieldDefs, isAdmin, isCounsellor]);

  const {error: recorderError, reset: resetRecorder} = recorder;

  // Surface recorder problems (denied mic, file write failures) as toasts.
  useEffect(() => {
    if (!recorderError) return;
    showToast(
      recorderError === 'permission'
        ? t('calls.createNote.voice.micDenied')
        : t('calls.createNote.voice.generateError'),
      'error',
    );
    setVoiceOpen(false);
    resetRecorder();
  }, [recorderError, resetRecorder, showToast, t]);

  const canUseVoice =
    isVoiceEnabled && isCounsellor && Boolean(chatId) && voiceFields.length > 0;

  if (!canUseVoice) return null;

  const handleMicPress = () => {
    if (isGenerating) return;
    setVoiceOpen(true);
    if (recorder.status === 'idle') {
      recorder.start();
    }
  };

  const handleDiscard = () => {
    recorder.reset();
    setVoiceOpen(false);
  };

  // Write the model's extracted values into the note. Built-in values merge
  // into the redux form and persist through the call-details endpoint (which
  // replaces the summary wholesale, so the merged set is sent); custom values
  // are encoded and upserted, then the parent re-seeds the details form.
  const applyGeneratedValues = async (
    values: {id: string; value: string}[],
  ): Promise<number> => {
    const builtinUpdates: Partial<SummaryFormData> = {};
    const customUpdates: {fieldDefinitionId: string; value: string}[] = [];
    let filled = 0;

    for (const {id, value} of values) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (builtinKeys.has(id)) {
        (builtinUpdates as Record<string, string>)[id] = trimmed;
        filled += 1;
      } else {
        const def = customDefsById.get(id);
        if (!def) continue;
        const encoded = encodeVoiceCustomValue(def, trimmed);
        if (encoded !== null) {
          customUpdates.push({fieldDefinitionId: id, value: encoded});
          filled += 1;
        }
      }
    }
    if (filled === 0) return 0;

    if (Object.keys(builtinUpdates).length > 0 && summaryData && chatId) {
      const merged = {
        ...(formData ?? {}),
        ...builtinUpdates,
      } as SummaryFormData;
      dispatch(setFormData(builtinUpdates));

      // Only the dictated fields are sent. Sending the whole summary would
      // revert anything added since this screen loaded its copy.
      const changedKeys = Object.keys(builtinUpdates) as SummaryFieldKey[];
      const extractedTags = builtinUpdates[SUMMARY_FIELDS.TAGS];
      // Tag names as dictated — the backend keeps the rating each tag already
      // had, so no LLM call sits between the counsellor and their save.
      const tagNames = extractedTags
        ? String(extractedTags)
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
        : undefined;

      const summaryPayload = transformFormDataForSubmission(
        merged,
        changedKeys,
        tagNames,
      );
      await updateCallSummary({
        chatId,
        data: {summary: summaryPayload},
      }).unwrap();
    }

    if (customUpdates.length > 0 && chatId) {
      await upsertCustomFieldValues({chatId, values: customUpdates}).unwrap();
      onCustomValuesApplied();
    }

    return filled;
  };

  const handleGenerate = async () => {
    if (!recorder.fileUri || !chatId) return;
    setIsGenerating(true);
    try {
      const result = await generateNoteFromAudio({
        fileUri: recorder.fileUri,
        fields: voiceFields,
      }).unwrap();

      const filled = await applyGeneratedValues(result.values ?? []);

      // Persist what was dictated so it shows in the note's Transcript tab.
      // Best-effort: a failure here must not fail the generation — the
      // extracted field values have already been applied and saved.
      const spoken = result.transcript?.trim();
      if (spoken) {
        transcriptRef.current = transcriptRef.current
          ? `${transcriptRef.current}\n${spoken}`
          : spoken;
        try {
          await saveNoteTranscript({
            chatId,
            transcript: transcriptRef.current,
          }).unwrap();
        } catch {
          // Non-fatal: the note and any extracted values still saved.
        }
      }

      recorder.reset();
      setVoiceOpen(false);
      if (filled > 0) {
        showToast(t('calls.createNote.voice.generated'), 'success');
      } else {
        showToast(t('calls.createNote.voice.nothingExtracted'), 'error');
      }
    } catch (error) {
      const message = (error as {data?: {message?: string}})?.data?.message;
      showToast(
        message === 'NO_SPEECH_DETECTED'
          ? t('calls.createNote.voice.noSpeech')
          : t('calls.createNote.voice.generateError'),
        'error',
      );
    } finally {
      setIsGenerating(false);
    }
  };

  if (!voiceOpen) {
    return (
      <TouchableOpacity
        style={styles.recordCta}
        onPress={handleMicPress}
        activeOpacity={0.8}
        testID="voice-note-record-cta">
        <MicIcon width={18} height={18} />
        <Text style={styles.recordCtaText}>
          {t('calls.createNote.voice.record')}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <VoiceNotePanel
      status={recorder.status}
      durationMs={recorder.durationMs}
      isGenerating={isGenerating}
      generatingMessages={[
        t('calls.createNote.voice.processing.transcribing'),
        t('calls.createNote.voice.processing.extracting'),
        t('calls.createNote.voice.processing.populating'),
      ]}
      onPause={recorder.pause}
      onResume={recorder.resume}
      onStop={() => recorder.stop()}
      onGenerate={() => handleGenerate()}
      onDiscard={handleDiscard}
    />
  );
};

const styles = ScaledSheet.create({
  recordCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6@ms',
    borderWidth: 1,
    borderColor: colors.azureBlue,
    borderRadius: '8@ms',
    paddingVertical: '10@ms',
    marginHorizontal: '16@s',
    marginTop: '10@ms',
  },
  recordCtaText: {
    ...typography.body.small,
    color: colors.azureBlue,
  },
});

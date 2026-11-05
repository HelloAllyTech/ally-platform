import React, {useCallback, useRef, useState} from 'react';
import {ScrollView, Text, TextInput, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {TickRoundIcon} from '@/assets';
import {Button, RichText} from '@/components';
import {useDebounce, useTranslate} from '@/hooks';
import {
  useSaveJournalDraftMutation,
  useSubmitJournalMutation,
} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {StartJournalItemPayload, TrackItemCompletionResult} from '@/types';

export interface JournalPlayerProps {
  payload: StartJournalItemPayload;
  itemId: string;
  alreadyCompleted: boolean;
  onCompleted: (result: TrackItemCompletionResult) => void;
}

const AUTOSAVE_DELAY = 1000;

/**
 * Journal item: one card per prompt with a debounced draft autosave and a
 * Submit that completes the item once every required prompt is answered.
 * Mirrors ally-web's `JournalItemPlayer`.
 */
export const JournalPlayer: React.FC<JournalPlayerProps> = ({
  payload,
  itemId,
  alreadyCompleted,
  onCompleted,
}) => {
  const {t} = useTranslate();
  const {prompts, savedResponses} = payload;

  const initial = prompts.map(
    prompt =>
      savedResponses.find(r => r.promptId === prompt.id)?.response ?? '',
  );
  const [responses, setResponses] = useState<string[]>(initial);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [submitted, setSubmitted] = useState(alreadyCompleted);
  const responsesRef = useRef(responses);
  responsesRef.current = responses;

  const [saveJournalDraft] = useSaveJournalDraftMutation();
  const [submitJournal, {isLoading: isSubmitting}] = useSubmitJournalMutation();

  const persist = useCallback(async () => {
    setSaving(true);
    try {
      await saveJournalDraft({
        itemId,
        responses: prompts.map((prompt, i) => ({
          promptId: prompt.id,
          response: responsesRef.current[i] ?? '',
        })),
      }).unwrap();
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
    setSaving(false);
  }, [itemId, prompts, saveJournalDraft]);

  const debouncedPersist = useDebounce(persist, {delay: AUTOSAVE_DELAY});

  const updateResponse = (index: number, value: string) => {
    setResponses(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (!submitted) debouncedPersist();
  };

  const allRequiredAnswered = prompts.every(
    (prompt, i) => !prompt.required || (responses[i] ?? '').trim().length > 0,
  );

  const handleSubmit = async () => {
    if (!allRequiredAnswered || isSubmitting || submitted) return;
    try {
      await persist();
      const result = await submitJournal({itemId}).unwrap();
      setSubmitted(true);
      onCompleted(result);
    } catch {
      // Submit stays available so the learner can retry.
    }
  };

  const renderAutosaveStatus = () => {
    if (submitted) {
      return (
        <Text style={styles.autosaveSubmitted}>
          {t('courses.journal.submitted')}
        </Text>
      );
    }
    if (saving) {
      return (
        <Text style={styles.autosaveDefault}>
          {t('courses.journal.saving')}
        </Text>
      );
    }
    if (saveFailed) {
      return (
        <Text style={styles.autosaveFailed}>
          {t('courses.journal.saveFailed')}
        </Text>
      );
    }
    return (
      <Text style={styles.autosaveDefault}>{t('courses.journal.saved')}</Text>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.autosaveRow}>{renderAutosaveStatus()}</View>
        {prompts.map((prompt, index) => (
          <View key={prompt.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{index + 1}</Text>
              </View>
              <View style={styles.promptContainer}>
                {prompt.promptHtml ? (
                  <>
                    <RichText
                      html={prompt.promptHtml}
                      textStyle={styles.promptRich}
                    />
                    {prompt.required && (
                      <Text style={styles.requiredTag}>
                        ({t('courses.journal.required')})
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.prompt}>
                    {prompt.prompt}
                    {prompt.required && (
                      <Text style={styles.requiredTag}>
                        {' '}
                        ({t('courses.journal.required')})
                      </Text>
                    )}
                  </Text>
                )}
              </View>
            </View>
            <TextInput
              testID={`journal-response-${prompt.id}`}
              style={styles.input}
              multiline
              numberOfLines={4}
              value={responses[index] ?? ''}
              onChangeText={value => updateResponse(index, value)}
              placeholder={
                prompt.placeholder ?? t('courses.journal.placeholder')
              }
              editable={!submitted}
            />
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {submitted ? (
          <View style={styles.submittedChip}>
            <TickRoundIcon
              width={16}
              height={16}
              color={colors.ds.green[700]}
            />
            <Text style={styles.submittedChipText}>
              {t('courses.journal.submitted')}
            </Text>
          </View>
        ) : (
          <Button
            testID="journal-submit"
            label={t('courses.journal.submit')}
            onPress={handleSubmit}
            isDisabled={!allRequiredAnswered}
            isLoading={isSubmitting}
          />
        )}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: '16@ms',
    gap: '16@ms',
  },
  autosaveRow: {
    alignItems: 'flex-end',
  },
  autosaveDefault: {
    ...typography.body.tiny,
    color: colors.ds.typography.lowEmphasis,
  },
  autosaveSubmitted: {
    ...typography.body.tiny,
    color: colors.ds.green[700],
  },
  autosaveFailed: {
    ...typography.body.tiny,
    color: colors.ds.red[400],
  },
  card: {
    borderRadius: '16@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    backgroundColor: colors.ds.neutral.white,
    padding: '16@ms',
    marginBottom: '16@ms',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: '10@ms',
    marginBottom: '10@ms',
  },
  badge: {
    width: '28@ms',
    height: '28@ms',
    borderRadius: '14@ms',
    backgroundColor: colors.ds.theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.neutral.white,
  },
  promptContainer: {
    flex: 1,
  },
  prompt: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  // Plain prompts stay medium, as before. Rich prompts start lighter so that
  // bold inside them actually stands out.
  promptRich: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
  requiredTag: {
    ...typography.body.tiny,
    fontWeight: fontWeights.regular,
    color: colors.ds.red[400],
  },
  input: {
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '10@ms',
    padding: '10@ms',
    minHeight: '96@ms',
    textAlignVertical: 'top',
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  footer: {
    borderTopWidth: 0.5,
    borderTopColor: colors.ds.stroke.primary,
    padding: '16@ms',
    alignItems: 'center',
  },
  submittedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
  },
  submittedChipText: {
    color: colors.ds.green[700],
  },
});

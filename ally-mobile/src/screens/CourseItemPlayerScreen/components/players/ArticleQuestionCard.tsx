import React, {useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button, RichText} from '@/components';
import {useTranslate} from '@/hooks';
import {useSubmitArticleQuestionAnswerMutation} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {ArticleQuestion, SubmitArticleQuestionAnswerResult} from '@/types';

import {QuestionMedia} from './QuestionMedia';

export interface ArticleQuestionCardProps {
  itemId: string;
  question: ArticleQuestion;
  /** Called with the server's response once an answer lands. */
  onAnswered: (result: SubmitArticleQuestionAnswerResult) => void;
}

/** What the card knows about this question's outcome, however it learned it. */
interface Resolution {
  selectedOptionId: string;
  correct: boolean;
  correctOptionId: string | null;
  explanation: string | null;
}

/**
 * One inline article question, rendered in the flow of the prose where its
 * placeholder sat. Mirrors ally-web's `ArticleQuestionCard`.
 *
 * Selecting an option is not the same as answering it. The answer is final —
 * the server refuses a second one — so committing on the first tap would turn
 * a mis-tap into a permanent wrong answer, which matters more on a phone than
 * it does with a mouse. The learner picks, then confirms, the same way a
 * video interjection is answered.
 *
 * Once answered the card shows the verdict, marks the correct option
 * whichever way it went, and adds the author's line on why if there is one:
 * being told only that you were wrong leaves you with nothing to correct.
 */
export const ArticleQuestionCard: React.FC<ArticleQuestionCardProps> = ({
  itemId,
  question,
  onAnswered,
}) => {
  const {t} = useTranslate();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [submitAnswer, {isLoading}] = useSubmitArticleQuestionAnswerMutation();

  // Answered in an earlier visit: the payload already carries the outcome.
  const [resolution, setResolution] = useState<Resolution | null>(() =>
    question.answered
      ? {
          selectedOptionId: question.answered.selectedOptionId,
          correct: question.answered.correct,
          correctOptionId: question.correctOptionId,
          explanation: question.explanation,
        }
      : null,
  );

  const handleSubmit = async () => {
    if (!selectedOptionId || isLoading || resolution) return;
    try {
      const result = await submitAnswer({
        itemId,
        questionId: question.id,
        selectedOptionId,
      }).unwrap();
      setResolution({
        selectedOptionId: result.selectedOptionId,
        correct: result.correct,
        correctOptionId: result.correctOptionId,
        explanation: result.explanation,
      });
      onAnswered(result);
    } catch {
      // Stays on the question so the learner can retry submitting.
    }
  };

  const optionStyle = (optionId: string) => {
    if (!resolution) {
      return selectedOptionId === optionId ? styles.optionSelected : null;
    }
    if (resolution.correctOptionId === optionId) return styles.optionCorrect;
    if (resolution.selectedOptionId === optionId) return styles.optionWrong;
    return styles.optionMuted;
  };

  return (
    <View testID={`article-question-${question.id}`} style={styles.card}>
      <Text style={styles.title}>{t('courses.article.question.title')}</Text>
      {question.promptHtml ? (
        <RichText html={question.promptHtml} textStyle={styles.promptRich} />
      ) : (
        <Text style={styles.prompt}>{question.prompt}</Text>
      )}
      <QuestionMedia media={question.media} />

      <View style={styles.list}>
        {(question.options ?? []).map(option => {
          const isChecked = resolution
            ? resolution.selectedOptionId === option.id
            : selectedOptionId === option.id;
          return (
            <TouchableOpacity
              key={option.id}
              testID={`article-question-option-${option.id}`}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityState={{
                checked: isChecked,
                disabled: !!resolution || isLoading,
              }}
              disabled={!!resolution || isLoading}
              onPress={() => setSelectedOptionId(option.id)}
              style={[styles.option, optionStyle(option.id)]}>
              <View
                style={[
                  styles.indicator,
                  isChecked && styles.indicatorSelected,
                ]}>
                {isChecked && <View style={styles.indicatorDot} />}
              </View>
              <Text style={styles.optionText}>{option.text}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {resolution ? (
        <View style={styles.feedback}>
          <View
            style={[
              styles.statusPill,
              resolution.correct
                ? styles.statusPillCorrect
                : styles.statusPillIncorrect,
            ]}>
            <Text
              style={[
                styles.statusPillText,
                resolution.correct
                  ? styles.statusPillTextCorrect
                  : styles.statusPillTextIncorrect,
              ]}>
              {resolution.correct
                ? t('courses.article.question.correct')
                : `${t('courses.article.question.incorrect')} — ${t(
                    'courses.article.question.correctAnswerIs',
                  )}`}
            </Text>
          </View>
          {!!resolution.explanation && (
            <Text style={styles.explanation}>{resolution.explanation}</Text>
          )}
          <Text style={styles.hint}>
            {t('courses.article.question.answeredHint')}
          </Text>
        </View>
      ) : (
        <Button
          testID={`article-question-submit-${question.id}`}
          label={t('courses.article.question.submit')}
          onPress={handleSubmit}
          isDisabled={!selectedOptionId || isLoading}
          isLoading={isLoading}
        />
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  card: {
    marginVertical: '16@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '16@ms',
    padding: '16@ms',
    gap: '10@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  title: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.lowEmphasis,
    textTransform: 'uppercase',
  },
  prompt: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
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
  list: {
    gap: '8@ms',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '12@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  optionSelected: {
    borderColor: colors.ds.theme.primary,
    backgroundColor: colors.ds.lightBlue[50],
  },
  optionCorrect: {
    borderColor: colors.ds.green[700],
    backgroundColor: colors.ds.green[50],
  },
  optionWrong: {
    borderColor: colors.ds.red[600],
    backgroundColor: colors.ds.red[50],
  },
  optionMuted: {
    opacity: 0.6,
  },
  indicator: {
    width: '20@ms',
    height: '20@ms',
    borderRadius: '10@ms',
    borderWidth: 2,
    borderColor: colors.ds.grey[300],
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorSelected: {
    borderColor: colors.ds.theme.primary,
    backgroundColor: colors.ds.theme.primary,
  },
  indicatorDot: {
    width: '8@ms',
    height: '8@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  optionText: {
    flex: 1,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  feedback: {
    gap: '8@ms',
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: '12@ms',
    paddingHorizontal: '12@ms',
    paddingVertical: '6@ms',
  },
  statusPillCorrect: {
    backgroundColor: colors.ds.green[50],
  },
  statusPillIncorrect: {
    backgroundColor: colors.ds.red[50],
  },
  statusPillText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
  },
  statusPillTextCorrect: {
    color: colors.ds.green[800],
  },
  statusPillTextIncorrect: {
    color: colors.ds.red[600],
  },
  explanation: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  hint: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.lowEmphasis,
  },
});

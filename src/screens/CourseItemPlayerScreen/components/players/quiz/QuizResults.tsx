import React, {useState} from 'react';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button, CircularProgress} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {
  QuizAttemptResult,
  QuizQuestionResult,
  SanitizedQuizQuestion,
} from '@/types';

export interface QuizResultsProps {
  result: QuizAttemptResult;
  questions: SanitizedQuizQuestion[];
  /** True while a regrade request is in flight. */
  isRegrading: boolean;
  canRetry: boolean;
  onRegrade: () => void;
  onRetry: () => void;
  onNext: () => void;
}

const QuestionRow: React.FC<{
  index: number;
  question: SanitizedQuizQuestion | undefined;
  result: QuizQuestionResult;
}> = ({index, question, result}) => {
  const {t} = useTranslate();
  const [open, setOpen] = useState(false);
  const isPending = result.correct === null;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        testID={`question-row-${result.questionId}`}
        style={styles.rowHeader}
        onPress={() => setOpen(o => !o)}>
        <View
          style={[
            styles.statusDot,
            isPending
              ? styles.statusPending
              : result.correct
                ? styles.statusCorrect
                : styles.statusIncorrect,
          ]}
        />
        <Text style={styles.rowPrompt} numberOfLines={2}>
          {index + 1}. {question?.prompt ?? ''}
        </Text>
        <Text style={styles.rowPoints}>
          {result.pointsAwarded}/{result.pointsPossible}
        </Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.rowDetail}>
          <Text style={styles.rowDetailStatus}>
            {isPending
              ? t('courses.quiz.results.pendingGrading')
              : result.correct
                ? t('courses.quiz.results.correct')
                : t('courses.quiz.results.incorrect')}
          </Text>
          {result.explanation && (
            <Text style={styles.rowDetailText}>
              <Text style={styles.rowDetailLabel}>
                {t('courses.quiz.results.explanation')}:{' '}
              </Text>
              {result.explanation}
            </Text>
          )}
          {result.llmFeedback && (
            <View style={styles.feedbackBox}>
              <Text style={styles.rowDetailText}>
                <Text style={styles.rowDetailLabel}>
                  {t('courses.quiz.results.feedback')}:{' '}
                </Text>
                {result.llmFeedback}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

/**
 * Quiz results screen: a circular score ring, pass/fail banner, per-question
 * accordion (with explanation + AI feedback), and the appropriate CTA —
 * finish-grading when pending, retry on a failed attempt with attempts left,
 * or Next once passed. Mirrors ally-web's `QuizResults`.
 */
export const QuizResults: React.FC<QuizResultsProps> = ({
  result,
  questions,
  isRegrading,
  canRetry,
  onRegrade,
  onRetry,
  onNext,
}) => {
  const {t} = useTranslate();
  const questionById = new Map(questions.map(q => [q.id, q]));
  const hasPending =
    result.status === 'PENDING_GRADING' ||
    result.questions.some(q => q.correct === null);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <CircularProgress
        progress={Math.round(result.scorePct)}
        max={100}
        size={96}
        strokeWidth={8}
        progressColor={
          result.passed ? colors.ds.green[400] : colors.ds.red[400]
        }>
        <Text style={styles.scoreText}>{Math.round(result.scorePct)}%</Text>
      </CircularProgress>

      <View
        style={[
          styles.statusPill,
          result.passed ? styles.statusPillPass : styles.statusPillFail,
        ]}>
        <Text
          style={[
            styles.statusPillText,
            result.passed
              ? styles.statusPillTextPass
              : styles.statusPillTextFail,
          ]}>
          {result.passed
            ? t('courses.quiz.results.passed')
            : t('courses.quiz.results.failed')}
        </Text>
      </View>

      {result.maxAttempts !== null && (
        <Text style={styles.attemptsUsed}>
          {t('courses.quiz.results.attemptsUsed', {
            used: result.attemptsUsed,
            max: result.maxAttempts,
          })}
        </Text>
      )}

      <View style={styles.questionList}>
        {result.questions.map((q, i) => (
          <QuestionRow
            key={q.questionId}
            index={i}
            question={questionById.get(q.questionId)}
            result={q}
          />
        ))}
      </View>

      <View style={styles.ctaRow}>
        {hasPending && (
          <Button
            testID="quiz-finish-grading"
            label={
              isRegrading
                ? t('courses.quiz.results.grading')
                : t('courses.quiz.results.finishGrading')
            }
            onPress={onRegrade}
            isDisabled={isRegrading}
          />
        )}
        {!hasPending && result.passed && (
          <Button
            testID="quiz-next"
            label={t('courses.quiz.results.next')}
            onPress={onNext}
          />
        )}
        {!hasPending && !result.passed && canRetry && (
          <Button
            testID="quiz-retry"
            label={t('courses.quiz.results.retry')}
            onPress={onRetry}
          />
        )}
      </View>
    </ScrollView>
  );
};

const styles = ScaledSheet.create({
  container: {
    alignItems: 'center',
    padding: '24@ms',
    gap: '12@ms',
  },
  scoreText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  statusPill: {
    borderRadius: '20@ms',
    paddingHorizontal: '16@ms',
    paddingVertical: '6@ms',
  },
  statusPillPass: {
    backgroundColor: colors.ds.green[50],
  },
  statusPillFail: {
    backgroundColor: colors.ds.red[50],
  },
  statusPillText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
  },
  statusPillTextPass: {
    color: colors.ds.green[800],
  },
  statusPillTextFail: {
    color: colors.ds.red[600],
  },
  attemptsUsed: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.lowEmphasis,
  },
  questionList: {
    width: '100%',
    gap: '8@ms',
    marginTop: '12@ms',
  },
  row: {
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
    padding: '12@ms',
  },
  statusDot: {
    width: '14@ms',
    height: '14@ms',
    borderRadius: '7@ms',
  },
  statusPending: {
    backgroundColor: colors.ds.amber[300],
  },
  statusCorrect: {
    backgroundColor: colors.ds.green[400],
  },
  statusIncorrect: {
    backgroundColor: colors.ds.red[400],
  },
  rowPrompt: {
    flex: 1,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  rowPoints: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.lowEmphasis,
  },
  rowDetail: {
    borderTopWidth: 0.5,
    borderTopColor: colors.ds.stroke.primary,
    padding: '12@ms',
  },
  rowDetailStatus: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '6@ms',
  },
  rowDetailText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  rowDetailLabel: {
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  feedbackBox: {
    backgroundColor: colors.ds.grey[50],
    borderRadius: '8@ms',
    padding: '8@ms',
    marginTop: '8@ms',
  },
  ctaRow: {
    width: '100%',
    marginTop: '16@ms',
  },
});

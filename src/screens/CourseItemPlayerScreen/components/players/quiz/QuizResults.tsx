import React, {useState} from 'react';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CheckCircleIcon} from '@/assets';
import {Button, CircularProgress} from '@/components';
import {useTranslate} from '@/hooks';
import {TranslationType} from '@/localization/locales/type';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {
  QuizAttemptResult,
  QuizCorrectAnswer,
  QuizQuestionResult,
  SanitizedQuizQuestion,
} from '@/types';
import {QuizAnswerState} from '@/utils';

import {QuestionMedia} from '../QuestionMedia';

export interface QuizResultsProps {
  result: QuizAttemptResult;
  questions: SanitizedQuizQuestion[];
  /** The learner's own submitted answers, keyed by questionId — needed to
   * show "Your responses" on a likert row, which carries no verdict of its
   * own to render instead. */
  answers?: Record<string, QuizAnswerState>;
  /** True while a regrade request is in flight. */
  isRegrading: boolean;
  canRetry: boolean;
  onRegrade: () => void;
  onRetry: () => void;
  onNext: () => void;
}

/**
 * Resolves the answer key's ids to the text the learner actually saw. An id
 * that no longer resolves (edited mid-attempt) is dropped, never shown raw.
 */
function formatCorrectAnswer(
  question: SanitizedQuizQuestion | undefined,
  correctAnswer: QuizCorrectAnswer,
  t: (key: TranslationType) => string,
): string {
  if (!question) return '';
  switch (question.type) {
    case 'mcq_single':
    case 'mcq_multi': {
      const byId = new Map((question.options ?? []).map(o => [o.id, o.text]));
      return (correctAnswer.selectedOptionIds ?? [])
        .map(id => byId.get(id))
        .filter(Boolean)
        .join(', ');
    }
    case 'true_false':
      return correctAnswer.booleanAnswer
        ? t('courses.quiz.question.true')
        : t('courses.quiz.question.false');
    case 'ordering': {
      const byId = new Map((question.items ?? []).map(o => [o.id, o.text]));
      return (correctAnswer.orderedItemIds ?? [])
        .map(id => byId.get(id))
        .filter(Boolean)
        .join(' → ');
    }
    case 'matching': {
      const leftById = new Map((question.left ?? []).map(o => [o.id, o.text]));
      const rightById = new Map(
        (question.right ?? []).map(o => [o.id, o.text]),
      );
      return (correctAnswer.pairs ?? [])
        .map(pair => {
          const left = leftById.get(pair.leftId);
          const right = rightById.get(pair.rightId);
          return left && right ? `${left} → ${right}` : '';
        })
        .filter(Boolean)
        .join(', ');
    }
    case 'fill_blank':
      return (correctAnswer.blanks ?? [])
        .map(blank => blank.acceptedAnswers.join(' / '))
        .join(', ');
    default:
      return '';
  }
}

const LikertResponses: React.FC<{
  question: SanitizedQuizQuestion;
  ratings?: Record<string, string>;
}> = ({question, ratings}) => {
  const {t} = useTranslate();
  const statements = question.statements ?? [];
  const scaleById = new Map((question.scale ?? []).map(s => [s.id, s.text]));

  return (
    <View>
      <Text style={styles.rowDetailLabel}>
        {t('courses.quiz.results.yourResponses')}
      </Text>
      <View style={styles.likertResponseList}>
        {statements.map(statement => (
          <View key={statement.id} style={styles.likertResponseRow}>
            <Text style={styles.rowDetailText}>{statement.text}</Text>
            <Text style={styles.likertResponseValue}>
              {scaleById.get(ratings?.[statement.id] ?? '') ?? '—'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const QuestionRow: React.FC<{
  index: number;
  question: SanitizedQuizQuestion | undefined;
  result: QuizQuestionResult;
  answerState?: QuizAnswerState;
}> = ({index, question, result, answerState}) => {
  const {t} = useTranslate();
  const [open, setOpen] = useState(false);
  // Old/new compat: a backend that predates `graded` never sends it, and an
  // absent flag reads as graded.
  const graded = result.graded !== false;
  const isPending = result.correct === null && graded;
  const isLikert = question?.type === 'likert_scale';

  const statusText = isPending
    ? t('courses.quiz.results.pendingGrading')
    : result.correct === null
      ? t('courses.quiz.results.notScored')
      : result.correct
        ? t('courses.quiz.results.correct')
        : t('courses.quiz.results.incorrect');

  return (
    <View style={styles.row}>
      <TouchableOpacity
        testID={`question-row-${result.questionId}`}
        style={styles.rowHeader}
        onPress={() => setOpen(o => !o)}>
        <View
          style={[
            styles.statusDot,
            !graded
              ? styles.statusNeutral
              : isPending
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
          {!graded
            ? t('courses.quiz.results.notScored')
            : `${result.pointsAwarded}/${result.pointsPossible}`}
        </Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.rowDetail}>
          {/* A learner reviewing a wrong answer needs what they were
              looking at, not just the words that framed it. */}
          <QuestionMedia media={question?.media} />
          {isLikert && question ? (
            <LikertResponses
              question={question}
              ratings={answerState?.ratings}
            />
          ) : (
            <>
              <Text style={styles.rowDetailStatus}>{statusText}</Text>
              {/* A right answer needs no correcting — the key is for the
                  learner who got it wrong. */}
              {result.correctAnswer &&
                result.correct === false &&
                formatCorrectAnswer(question, result.correctAnswer, t) !==
                  '' && (
                  <Text style={styles.rowDetailText}>
                    <Text style={styles.rowDetailLabel}>
                      {t('courses.quiz.results.correctAnswer')}:{' '}
                    </Text>
                    {formatCorrectAnswer(question, result.correctAnswer, t)}
                  </Text>
                )}
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
            </>
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
 * or Next once passed. A survey (no graded questions — `scorePct` is null)
 * replaces the score ring and pass/fail banner with a neutral "Responses
 * submitted" state and always offers Next. Mirrors ally-web's `QuizResults`.
 */
export const QuizResults: React.FC<QuizResultsProps> = ({
  result,
  questions,
  answers,
  isRegrading,
  canRetry,
  onRegrade,
  onRetry,
  onNext,
}) => {
  const {t} = useTranslate();
  const questionById = new Map(questions.map(q => [q.id, q]));
  const isSurvey = result.scorePct === null;
  const hasPending =
    result.status === 'PENDING_GRADING' ||
    result.questions.some(q => q.correct === null && q.graded !== false);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {isSurvey ? (
        <>
          <View style={styles.surveyIconCircle}>
            <CheckCircleIcon width={40} height={40} />
          </View>
          <Text style={styles.surveyTitle}>
            {t('courses.quiz.results.responsesSubmitted')}
          </Text>
        </>
      ) : (
        <>
          <CircularProgress
            progress={Math.round(result.scorePct ?? 0)}
            max={100}
            size={96}
            strokeWidth={8}
            progressColor={
              result.passed ? colors.ds.green[400] : colors.ds.red[400]
            }>
            <Text style={styles.scoreText}>
              {Math.round(result.scorePct ?? 0)}%
            </Text>
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
        </>
      )}

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
            answerState={answers?.[q.questionId]}
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
        {!hasPending && (isSurvey || result.passed) && (
          <Button
            testID="quiz-next"
            label={t('courses.quiz.results.next')}
            onPress={onNext}
          />
        )}
        {!hasPending && !isSurvey && !result.passed && canRetry && (
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
  surveyIconCircle: {
    width: '96@ms',
    height: '96@ms',
    borderRadius: '48@ms',
    backgroundColor: colors.ds.green[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  surveyTitle: {
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
  statusNeutral: {
    backgroundColor: colors.ds.grey[400],
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
  likertResponseList: {
    gap: '6@ms',
    marginTop: '4@ms',
  },
  likertResponseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: '8@ms',
  },
  likertResponseValue: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.theme.primary,
  },
  ctaRow: {
    width: '100%',
    marginTop: '16@ms',
  },
});

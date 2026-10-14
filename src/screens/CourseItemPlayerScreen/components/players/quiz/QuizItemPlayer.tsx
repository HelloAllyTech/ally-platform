import React, {useEffect, useState} from 'react';
import {AccessibilityInfo, ScrollView, Text, View} from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowRight, LeftArrowIcon} from '@/assets';
import {Button, RichText} from '@/components';
import {useTranslate} from '@/hooks';
import {
  useRegradeQuizAttemptMutation,
  useStartTrackItemMutation,
  useSubmitQuizAttemptMutation,
} from '@/services';
import {colors} from '@/theme';
import {
  QuizAttemptResult,
  SanitizedQuiz,
  StartQuizItemPayload,
  TrackItemCompletionResult,
  TrackItemType,
} from '@/types';
import {
  initialAnswerState,
  isAnswered,
  QuizAnswerState,
  toAnswerInput,
} from '@/utils';

import {QuestionMedia} from '../QuestionMedia';
import {QuizIntro} from './QuizIntro';
import {QuizResults} from './QuizResults';
import {FillBlankQuestion} from './widgets/FillBlankQuestion';
import {LikertScaleQuestion} from './widgets/LikertScaleQuestion';
import {MatchingQuestion} from './widgets/MatchingQuestion';
import {McqQuestion} from './widgets/McqQuestion';
import {OpenEndedQuestion} from './widgets/OpenEndedQuestion';
import {OrderingQuestion} from './widgets/OrderingQuestion';
import {TrueFalseQuestion} from './widgets/TrueFalseQuestion';

export interface QuizItemPlayerProps {
  payload: StartQuizItemPayload;
  itemId: string;
  onCompleted: (result: TrackItemCompletionResult) => void;
  onRequestNext: () => void;
}

type Phase = 'intro' | 'questions' | 'results';

/**
 * Quiz item player — intro card, one question per screen, single-shot
 * submit, and a results screen. Handles PENDING_GRADING via regrade, and
 * retry (which re-fetches start for a reshuffled question set) when the
 * attempt fails and attempts remain. Mirrors ally-web's `QuizItemPlayer`.
 */
export const QuizItemPlayer: React.FC<QuizItemPlayerProps> = ({
  payload,
  itemId,
  onCompleted,
  onRequestNext,
}) => {
  const {t} = useTranslate();

  const [quiz, setQuiz] = useState<SanitizedQuiz>(payload.quiz);
  const [attemptsUsed, setAttemptsUsed] = useState(payload.attemptsUsed);
  const [phase, setPhase] = useState<Phase>('intro');
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuizAnswerState>>({});
  const [result, setResult] = useState<QuizAttemptResult | null>(null);

  const [submitQuizAttempt, {isLoading: isSubmitting}] =
    useSubmitQuizAttemptMutation();
  const [regradeQuizAttempt, {isLoading: isRegrading}] =
    useRegradeQuizAttemptMutation();
  const [startTrackItem] = useStartTrackItemMutation();

  const questions = quiz.questions;
  const maxAttempts = payload.maxAttempts;

  const resetAnswers = (q: SanitizedQuiz) => {
    const seed: Record<string, QuizAnswerState> = {};
    q.questions.forEach(question => {
      seed[question.id] = initialAnswerState(question);
    });
    setAnswers(seed);
  };

  // Seed answer state once on mount from the initial payload.
  useEffect(() => {
    resetAnswers(payload.quiz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startQuiz = () => {
    resetAnswers(quiz);
    setCurrent(0);
    setResult(null);
    setPhase('questions');
  };

  const setAnswer = (questionId: string, state: QuizAnswerState) =>
    setAnswers(prev => ({...prev, [questionId]: state}));

  const fireConfetti = async () => {
    const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
    if (reduceMotion) return;
    setShowConfetti(true);
  };
  const [showConfetti, setShowConfetti] = useState(false);

  const applyAttemptResult = (attempt: QuizAttemptResult) => {
    setResult(attempt);
    setAttemptsUsed(attempt.attemptsUsed);
    setPhase('results');
    if (attempt.passed && attempt.itemCompleted) {
      fireConfetti();
      onCompleted({
        completed: attempt.itemCompleted,
        unlockedItemIds: attempt.unlockedItemIds,
        sectionCompleted: attempt.sectionCompleted,
        trackCompleted: attempt.trackCompleted,
      });
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    try {
      const answerInputs = questions.map(q =>
        toAnswerInput(q, answers[q.id] ?? {}),
      );
      const attempt = await submitQuizAttempt({
        itemId,
        answers: answerInputs,
      }).unwrap();
      applyAttemptResult(attempt);
    } catch {
      // Stays on the last question so the learner can retry submitting.
    }
  };

  const handleRegrade = async () => {
    if (!result || isRegrading) return;
    try {
      const attempt = await regradeQuizAttempt({
        itemId,
        attemptId: result.attemptId,
      }).unwrap();
      applyAttemptResult(attempt);
    } catch {
      // Button stays available so the learner can retry.
    }
  };

  const handleRetry = async () => {
    try {
      const fresh = await startTrackItem({itemId}).unwrap();
      if (fresh.type === TrackItemType.QUIZ) {
        setQuiz(fresh.quiz);
        setAttemptsUsed(fresh.attemptsUsed);
        resetAnswers(fresh.quiz);
      } else {
        resetAnswers(quiz);
      }
      setCurrent(0);
      setResult(null);
      setPhase('questions');
    } catch {
      // Results screen stays up so the learner can retry.
    }
  };

  if (phase === 'intro') {
    return (
      <QuizIntro
        quiz={quiz}
        attemptsUsed={attemptsUsed}
        maxAttempts={maxAttempts}
        onStart={startQuiz}
      />
    );
  }

  if (phase === 'results' && result) {
    const attemptsLeft =
      maxAttempts === null ? Infinity : maxAttempts - attemptsUsed;
    return (
      <>
        <QuizResults
          result={result}
          questions={questions}
          answers={answers}
          isRegrading={isRegrading}
          canRetry={attemptsLeft > 0}
          onRegrade={handleRegrade}
          onRetry={handleRetry}
          onNext={onRequestNext}
        />
        {showConfetti && (
          <ConfettiCannon
            fadeOut
            count={90}
            origin={{x: 0, y: 0}}
            onAnimationEnd={() => setShowConfetti(false)}
          />
        )}
      </>
    );
  }

  const question = questions[current];
  const answerState = answers[question.id] ?? {};
  const answered = isAnswered(question, answerState);
  const isLast = current === questions.length - 1;

  const renderWidget = () => {
    switch (question.type) {
      case 'mcq_single':
      case 'mcq_multi':
        return (
          <McqQuestion
            question={question}
            state={answerState}
            onChange={s => setAnswer(question.id, s)}
          />
        );
      case 'true_false':
        return (
          <TrueFalseQuestion
            state={answerState}
            onChange={s => setAnswer(question.id, s)}
          />
        );
      case 'ordering':
        return (
          <OrderingQuestion
            question={question}
            state={answerState}
            onChange={s => setAnswer(question.id, s)}
          />
        );
      case 'matching':
        return (
          <MatchingQuestion
            question={question}
            state={answerState}
            onChange={s => setAnswer(question.id, s)}
          />
        );
      case 'fill_blank':
        return (
          <FillBlankQuestion
            question={question}
            state={answerState}
            onChange={s => setAnswer(question.id, s)}
          />
        );
      case 'open_ended':
        return (
          <OpenEndedQuestion
            question={question}
            state={answerState}
            onChange={s => setAnswer(question.id, s)}
          />
        );
      case 'likert_scale':
        return (
          <LikertScaleQuestion
            question={question}
            state={answerState}
            onChange={s => setAnswer(question.id, s)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>
        {t('courses.quiz.question.progress', {
          current: current + 1,
          total: questions.length,
        })}
      </Text>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <RichText
          html={question.promptHtml ?? question.prompt}
          style={styles.prompt}
        />
        <QuestionMedia media={question.media} />
        {renderWidget()}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerButton}>
          <Button
            testID="quiz-back"
            label={t('courses.quiz.question.back')}
            variant="secondary"
            onPress={() => setCurrent(c => Math.max(0, c - 1))}
            isDisabled={current === 0}
            IconLeft={LeftArrowIcon}
            iconSize={14}
          />
        </View>
        <View style={styles.footerButton}>
          {isLast ? (
            <Button
              testID="quiz-submit"
              label={t('courses.quiz.question.submit')}
              onPress={handleSubmit}
              isDisabled={!answered || isSubmitting}
            />
          ) : (
            <Button
              testID="quiz-next-question"
              label={t('courses.quiz.question.next')}
              onPress={() =>
                setCurrent(c => Math.min(questions.length - 1, c + 1))
              }
              isDisabled={!answered}
              IconRight={ArrowRight}
              iconSize={14}
              iconColor={colors.ds.neutral.white}
            />
          )}
        </View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  progress: {
    padding: '16@ms',
    paddingBottom: 0,
    color: colors.ds.typography.mediumEmphasis,
  },
  scrollContent: {
    padding: '16@ms',
  },
  prompt: {
    color: colors.ds.typography.highEmphasis,
    fontSize: '16@ms',
    marginBottom: '16@ms',
  },
  footer: {
    flexDirection: 'row',
    gap: '12@ms',
    padding: '16@ms',
    borderTopWidth: 0.5,
    borderTopColor: colors.ds.stroke.primary,
  },
  footerButton: {
    flex: 1,
  },
});

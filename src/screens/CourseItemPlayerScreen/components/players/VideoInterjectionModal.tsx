import React, {useEffect, useState} from 'react';
import {Modal, ScrollView, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button, RichText} from '@/components';
import {useTranslate} from '@/hooks';
import {useSubmitInterjectionAnswerMutation} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {VideoInterjection} from '@/types';
import {
  initialAnswerState,
  isAnswered,
  QuizAnswerState,
  toAnswerInput,
} from '@/utils';

import {QuestionMedia} from './QuestionMedia';
import {FillBlankQuestion} from './quiz/widgets/FillBlankQuestion';
import {MatchingQuestion} from './quiz/widgets/MatchingQuestion';
import {McqQuestion} from './quiz/widgets/McqQuestion';
import {OrderingQuestion} from './quiz/widgets/OrderingQuestion';
import {TrueFalseQuestion} from './quiz/widgets/TrueFalseQuestion';

export interface VideoInterjectionModalProps {
  /** Null when no interjection is active — the modal stays mounted but hidden. */
  interjection: VideoInterjection | null;
  itemId: string;
  /** Fired once the answer is graded, before Continue is pressed. */
  onAnswered: (
    interjectionId: string,
    passed: boolean,
    pointsAwarded?: number,
  ) => void;
  /** Fired on Continue — the caller resumes playback. */
  onContinue: () => void;
}

type Phase = 'question' | 'feedback';

/**
 * Blocking overlay for a video interjection: the same quiz widgets used by
 * the standalone `QuizItemPlayer`, one question, no back/skip. Mirrors
 * `CelebrationModal`'s exact full-screen `Modal` props (not the app's usual
 * bottom-sheet pattern, which is swipe-dismissible — wrong fit for a
 * mandatory checkpoint) with no `onRequestClose` dismiss handling, since the
 * learner cannot back out of an interjection.
 */
export const VideoInterjectionModal: React.FC<VideoInterjectionModalProps> = ({
  interjection,
  itemId,
  onAnswered,
  onContinue,
}) => {
  const {t} = useTranslate();
  const [phase, setPhase] = useState<Phase>('question');
  const [answerState, setAnswerState] = useState<QuizAnswerState>({});
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [pointsAwarded, setPointsAwarded] = useState<number | undefined>(
    undefined,
  );
  const [submitInterjectionAnswer, {isLoading}] =
    useSubmitInterjectionAnswerMutation();

  // Reset local state whenever a new interjection becomes active.
  useEffect(() => {
    if (interjection) {
      setAnswerState(initialAnswerState(interjection.question));
      setPhase('question');
      setCorrect(null);
      setPointsAwarded(undefined);
    }
  }, [interjection]);

  const handleSubmit = async () => {
    if (!interjection || isLoading) return;
    try {
      const result = await submitInterjectionAnswer({
        itemId,
        interjectionId: interjection.id,
        answer: toAnswerInput(interjection.question, answerState),
      }).unwrap();
      setCorrect(result.correct);
      setPointsAwarded(result.grading.pointsAwarded);
      setPhase('feedback');
    } catch {
      // Stays on the question so the learner can retry submitting.
    }
  };

  const handleContinue = () => {
    if (interjection) {
      onAnswered(interjection.id, correct === true, pointsAwarded);
    }
    onContinue();
  };

  const question = interjection?.question ?? null;
  const answered = question ? isAnswered(question, answerState) : false;

  const renderWidget = () => {
    if (!question) return null;
    switch (question.type) {
      case 'mcq_single':
      case 'mcq_multi':
        return (
          <McqQuestion
            question={question}
            state={answerState}
            onChange={setAnswerState}
          />
        );
      case 'true_false':
        return (
          <TrueFalseQuestion state={answerState} onChange={setAnswerState} />
        );
      case 'ordering':
        return (
          <OrderingQuestion
            question={question}
            state={answerState}
            onChange={setAnswerState}
          />
        );
      case 'matching':
        return (
          <MatchingQuestion
            question={question}
            state={answerState}
            onChange={setAnswerState}
          />
        );
      case 'fill_blank':
        return (
          <FillBlankQuestion
            question={question}
            state={answerState}
            onChange={setAnswerState}
          />
        );
      default:
        // open_ended never appears in interjections (LLM-graded questions
        // aren't authored here) — nothing to render.
        return null;
    }
  };

  return (
    <Modal
      visible={!!interjection}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen">
      <View style={styles.overlay}>
        <View style={styles.card}>
          {question && phase === 'question' && (
            <>
              <Text style={styles.title}>
                {t('courses.video.interjection.title')}
              </Text>
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}>
                {question.promptHtml ? (
                  <RichText
                    html={question.promptHtml}
                    style={styles.prompt}
                    textStyle={styles.prompt}
                  />
                ) : (
                  <Text style={styles.prompt}>{question.prompt}</Text>
                )}
                <QuestionMedia media={question.media} />
                {renderWidget()}
              </ScrollView>
              <Button
                testID="interjection-submit"
                label={t('courses.video.interjection.submit')}
                onPress={handleSubmit}
                isDisabled={!answered || isLoading}
                isLoading={isLoading}
              />
            </>
          )}

          {question && phase === 'feedback' && (
            <>
              <View
                style={[
                  styles.statusPill,
                  correct
                    ? styles.statusPillCorrect
                    : styles.statusPillIncorrect,
                ]}>
                <Text
                  style={[
                    styles.statusPillText,
                    correct
                      ? styles.statusPillTextCorrect
                      : styles.statusPillTextIncorrect,
                  ]}>
                  {correct
                    ? t('courses.quiz.results.correct')
                    : t('courses.quiz.results.incorrect')}
                </Text>
              </View>
              <Text style={styles.body}>
                {t('courses.video.interjection.continueBody')}
              </Text>
              <Button
                testID="interjection-continue"
                label={t('courses.video.interjection.continue')}
                onPress={handleContinue}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.blackTransparent50,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '24@ms',
  },
  card: {
    width: '100%',
    maxWidth: '420@ms',
    maxHeight: '80%',
    backgroundColor: colors.ds.neutral.white,
    borderRadius: '20@ms',
    padding: '20@ms',
    gap: '12@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: '4@ms',
  },
  prompt: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '16@ms',
  },
  statusPill: {
    alignSelf: 'center',
    borderRadius: '20@ms',
    paddingHorizontal: '16@ms',
    paddingVertical: '6@ms',
  },
  statusPillCorrect: {
    backgroundColor: colors.ds.green[50],
  },
  statusPillIncorrect: {
    backgroundColor: colors.ds.red[50],
  },
  statusPillText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
  },
  statusPillTextCorrect: {
    color: colors.ds.green[800],
  },
  statusPillTextIncorrect: {
    color: colors.ds.red[600],
  },
  body: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
});

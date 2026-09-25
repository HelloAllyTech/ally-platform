import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {SanitizedQuiz} from '@/types';

export interface QuizIntroProps {
  quiz: SanitizedQuiz;
  attemptsUsed: number;
  maxAttempts: number | null;
  onStart: () => void;
}

/** Quiz landing card: question count, pass score, attempts remaining. Mirrors ally-web's `QuizIntro`. */
export const QuizIntro: React.FC<QuizIntroProps> = ({
  quiz,
  attemptsUsed,
  maxAttempts,
  onStart,
}) => {
  const {t, tVariable} = useTranslate();
  const questionCount = quiz.questions.length;
  const attemptsLeft =
    maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed);
  const canStart = attemptsLeft === null || attemptsLeft > 0;
  // A survey has nothing to pass — no graded question contributes points.
  const isSurvey =
    quiz.totalPoints === 0 ||
    quiz.questions.every(question => question.graded === false);

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>📝</Text>
      </View>
      <Text style={styles.title}>{t('courses.quiz.intro.title')}</Text>

      <View style={styles.metaList}>
        <Text style={styles.metaText}>
          {tVariable('courses.quiz.intro.questionCount', {
            count: questionCount,
          })}
        </Text>
        {!isSurvey && (
          <Text style={styles.metaText}>
            {t('courses.quiz.intro.passScore', {
              score: quiz.settings.passScore,
            })}
          </Text>
        )}
        <Text style={styles.metaText}>
          {attemptsLeft === null
            ? t('courses.quiz.intro.unlimitedAttempts')
            : tVariable('courses.quiz.intro.attemptsLeft', {
                count: attemptsLeft,
              })}
        </Text>
      </View>

      <Button
        testID="quiz-start"
        label={
          canStart
            ? t('courses.quiz.intro.start')
            : t('courses.quiz.intro.noAttemptsLeft')
        }
        onPress={onStart}
        isDisabled={!canStart}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16@ms',
    paddingHorizontal: '24@ms',
  },
  iconCircle: {
    width: '64@ms',
    height: '64@ms',
    borderRadius: '32@ms',
    backgroundColor: colors.ds.lightBlue[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: '28@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  metaList: {
    alignItems: 'center',
    gap: '4@ms',
  },
  metaText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
});

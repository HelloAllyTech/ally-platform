import React, {useCallback, useMemo, useState} from 'react';
import {Image, Pressable, ScrollView, Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {useRecordBranchingResultMutation} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {
  BranchingNode,
  BranchingOutcome,
  BranchingResult,
  StartBranchingScenarioItemPayload,
  TrackItemCompletionResult,
} from '@/types';

export interface BranchingScenarioPlayerProps {
  payload: StartBranchingScenarioItemPayload;
  itemId: string;
  onCompleted: (result: TrackItemCompletionResult) => void;
  onRequestNext: () => void;
}

const OUTCOME_COLORS: Record<BranchingOutcome, {bg: string; fg: string}> = {
  POSITIVE: {
    bg: colors.ds.feedback.successContainer,
    fg: colors.ds.feedback.onSuccessContainer,
  },
  MIXED: {
    bg: colors.ds.feedback.warningContainer,
    fg: colors.ds.amber[900],
  },
  NEGATIVE: {
    bg: colors.ds.feedback.errorContainer,
    fg: colors.ds.feedback.onErrorContainer,
  },
};

/** The server refuses a finished run once the attempts are gone. */
const isAttemptsExhaustedError = (error: unknown): boolean => {
  const e = error as {status?: number; data?: {message?: unknown}} | undefined;
  const message = e?.data?.message;
  const text = Array.isArray(message) ? message.join(' ') : String(message);
  return e?.status === 400 && /used all attempts/i.test(text);
};

/**
 * Branching scenario: the learner reads a scene, picks a reply, and lives the
 * next scene. The whole graph arrives in the start payload and is walked
 * locally; only the finished path goes back, and the server's score (never a
 * local one) is what this shows.
 *
 * A choice is final within a run — there is no back, so the consequence lands.
 * "Try again" restarts from the first scene.
 */
export const BranchingScenarioPlayer: React.FC<
  BranchingScenarioPlayerProps
> = ({payload, itemId, onCompleted, onRequestNext}) => {
  const {t} = useTranslate();
  const [recordResult, {isLoading: isSaving}] =
    useRecordBranchingResultMutation();

  const nodesById = useMemo(
    () => new Map(payload.nodes.map(node => [node.id, node])),
    [payload.nodes],
  );
  const endingCount = useMemo(
    () => payload.nodes.filter(n => !n.choices?.length).length,
    [payload.nodes],
  );

  const [nodeId, setNodeId] = useState(payload.startNodeId);
  const [path, setPath] = useState<string[]>([]);
  const [result, setResult] = useState<BranchingResult | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [endingsSeen, setEndingsSeen] = useState(payload.endingsReached.length);
  // Once the item is complete a replay costs nothing, so it is never gated.
  const [replayFree, setReplayFree] = useState(payload.completed);

  const node = nodesById.get(nodeId);
  const isEnding = !!node && !node.choices?.length;
  const gated = payload.passScore !== null;

  // Attempts already gone on arrival: say so instead of letting the learner
  // play a run the server will refuse to record.
  const exhaustedOnArrival =
    !payload.completed &&
    payload.maxAttempts !== null &&
    payload.attemptsUsed >= payload.maxAttempts;

  const chosenText = useCallback(
    (index: number) => {
      // Text of the choice made at step `index` of the path.
      let current = nodesById.get(payload.startNodeId);
      for (let i = 0; i <= index && current; i++) {
        const choice = current.choices?.find(c => c.id === path[i]);
        if (i === index) return choice?.text ?? '';
        current = choice ? nodesById.get(choice.nextNodeId) : undefined;
      }
      return '';
    },
    [nodesById, path, payload.startNodeId],
  );

  const submit = useCallback(
    async (finalPath: string[]) => {
      setSaveFailed(false);
      try {
        const res = await recordResult({itemId, path: finalPath}).unwrap();
        setResult(res);
        setEndingsSeen(res.endingsReached.length);
        if (res.itemCompleted) setReplayFree(true);
        if ((res.passed || res.itemCompleted) && res.completion) {
          onCompleted(res.completion);
        }
      } catch (error) {
        if (isAttemptsExhaustedError(error)) {
          setExhausted(true);
        } else {
          setSaveFailed(true);
        }
      }
    },
    [itemId, onCompleted, recordResult],
  );

  const handleChoose = (choiceId: string, nextNodeId: string) => {
    if (!nodesById.has(nextNodeId)) return;
    const nextPath = [...path, choiceId];
    setPath(nextPath);
    setNodeId(nextNodeId);
    const next = nodesById.get(nextNodeId);
    if (next && !next.choices?.length) {
      submit(nextPath);
    }
  };

  const handleRestart = () => {
    setNodeId(payload.startNodeId);
    setPath([]);
    setResult(null);
    setSaveFailed(false);
    setExhausted(false);
  };

  const exhaustedMessage = (
    <Text style={styles.notice} testID="branching-exhausted">
      {t('courses.branching.attemptsUsedUp')}
    </Text>
  );

  if (exhaustedOnArrival) {
    return (
      <View style={styles.centered} testID="branching-player">
        {exhaustedMessage}
      </View>
    );
  }

  // A payload whose graph does not resolve (bad start id) has nothing to play.
  if (!node) {
    return (
      <View style={styles.centered} testID="branching-player">
        <Text style={styles.notice}>{t('courses.player.unsupportedBody')}</Text>
      </View>
    );
  }

  const renderScene = (scene: BranchingNode) => (
    <>
      {scene.image?.url ? (
        <Image
          source={{uri: scene.image.url}}
          style={styles.image}
          resizeMode="cover"
          accessible={!!scene.image.alt}
          accessibilityRole="image"
          accessibilityLabel={scene.image.alt || undefined}
        />
      ) : null}
      {scene.title ? (
        <Text style={styles.sceneTitle} accessibilityRole="header">
          {scene.title}
        </Text>
      ) : null}
      <Text style={styles.sceneText}>{scene.text}</Text>
    </>
  );

  const renderTrail = () =>
    path.length > 0 ? (
      <View
        style={styles.trail}
        accessible
        accessibilityLabel={t('courses.branching.trailLabel')}>
        {path.map((choiceId, i) => (
          <View key={`${choiceId}-${i}`} style={styles.chip}>
            <Text style={styles.chipText} numberOfLines={2}>
              {t('courses.branching.youChose', {text: chosenText(i)})}
            </Text>
          </View>
        ))}
      </View>
    ) : null;

  const renderEnding = (ending: BranchingNode) => {
    const outcome = ending.outcome;
    // Server response is the truth; before it lands there is nothing to score.
    const passScore = result ? result.passScore : payload.passScore;
    const canRetry =
      replayFree ||
      !result ||
      result.attemptsLeft === null ||
      result.attemptsLeft > 0;
    const showScore = result !== null && passScore !== null;
    const done = !!result && (result.passed || result.itemCompleted);

    return (
      <>
        {outcome ? (
          <View
            style={[
              styles.badge,
              {backgroundColor: OUTCOME_COLORS[outcome].bg},
            ]}>
            <Text
              style={[styles.badgeText, {color: OUTCOME_COLORS[outcome].fg}]}>
              {t(`courses.branching.outcome.${outcome}`)}
            </Text>
          </View>
        ) : null}
        {renderScene(ending)}

        {showScore && result ? (
          <View style={styles.scoreCard} testID="branching-score">
            <Text style={styles.scoreText}>
              {t('courses.branching.score', {score: result.score})}
            </Text>
            <Text style={styles.scoreMeta}>
              {t('courses.branching.passMark', {score: passScore})}
              {result.attemptsLeft !== null && !result.itemCompleted
                ? ` · ${t('courses.branching.attemptsLeft', {
                    count: result.attemptsLeft,
                  })}`
                : ''}
            </Text>
            <Text style={styles.scoreMeta}>
              {result.passed
                ? t('courses.branching.passed')
                : t('courses.branching.notPassed')}
            </Text>
          </View>
        ) : null}

        {ending.takeaway ? (
          <Text style={styles.takeaway}>{ending.takeaway}</Text>
        ) : null}
        {renderTrail()}

        {saveFailed ? (
          <>
            <Text style={styles.notice} accessibilityRole="alert">
              {t('courses.branching.saveFailed')}
            </Text>
            <Button
              testID="branching-retry-save"
              label={t('courses.branching.retrySave')}
              onPress={() => submit(path)}
              isLoading={isSaving}
            />
          </>
        ) : null}
        {exhausted ? exhaustedMessage : null}

        {result ? (
          <View style={styles.actions}>
            {done ? (
              <Button
                testID="branching-continue"
                label={t('courses.branching.continue')}
                onPress={onRequestNext}
              />
            ) : null}
            {canRetry ? (
              <Button
                testID="branching-try-again"
                label={t('courses.branching.tryAgain')}
                variant={done ? 'secondary' : 'primary'}
                onPress={handleRestart}
              />
            ) : (
              exhaustedMessage
            )}
          </View>
        ) : null}
      </>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      testID="branching-player">
      {path.length === 0 && payload.intro ? (
        <Text style={styles.intro}>{payload.intro}</Text>
      ) : null}
      {path.length === 0 && endingsSeen > 0 && endingCount > 0 ? (
        <Text style={styles.progressNote} testID="branching-endings-seen">
          {t('courses.branching.endingsSeen', {
            seen: endingsSeen,
            total: endingCount,
          })}
          {gated && payload.bestScore !== null
            ? ` · ${t('courses.branching.bestScore', {
                score: payload.bestScore,
              })}`
            : ''}
        </Text>
      ) : null}

      {isEnding ? (
        renderEnding(node)
      ) : (
        <>
          {renderTrail()}
          {renderScene(node)}
          <Text style={styles.ask}>{t('courses.branching.choicePrompt')}</Text>
          {(node.choices ?? []).map(choice => (
            <Pressable
              key={choice.id}
              testID={`branching-choice-${choice.id}`}
              accessibilityRole="button"
              accessibilityLabel={choice.text}
              onPress={() => handleChoose(choice.id, choice.nextNodeId)}
              style={({pressed}) => [
                styles.choice,
                pressed && styles.choicePressed,
              ]}>
              <Text style={styles.choiceText}>{choice.text}</Text>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
};

const styles = ScaledSheet.create({
  content: {
    flexGrow: 1,
    gap: '12@ms',
    paddingHorizontal: '16@ms',
    paddingVertical: '16@ms',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '24@ms',
  },
  intro: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  progressNote: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  image: {
    width: '100%',
    height: ms(180),
    borderRadius: '12@ms',
    backgroundColor: colors.ds.grey[100],
  },
  sceneTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  sceneText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
  ask: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '4@ms',
  },
  choice: {
    minHeight: '44@ms',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    backgroundColor: colors.ds.neutral.white,
    paddingHorizontal: '14@ms',
    paddingVertical: '12@ms',
  },
  choicePressed: {
    borderColor: colors.ds.theme.primary,
    backgroundColor: colors.ds.blue[50],
  },
  choiceText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
  trail: {flexDirection: 'row', flexWrap: 'wrap', gap: '6@ms'},
  chip: {
    maxWidth: '100%',
    borderRadius: '99@ms',
    backgroundColor: colors.ds.blue[50],
    paddingHorizontal: '10@ms',
    paddingVertical: '4@ms',
  },
  chipText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.theme.primary,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: '99@ms',
    paddingHorizontal: '12@ms',
    paddingVertical: '4@ms',
  },
  badgeText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
  },
  scoreCard: {
    gap: '4@ms',
    borderWidth: 1.5,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '12@ms',
  },
  scoreText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  scoreMeta: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  takeaway: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    borderLeftWidth: 3,
    borderLeftColor: colors.ds.theme.primary,
    paddingLeft: '12@ms',
  },
  notice: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  actions: {gap: '10@ms', marginTop: '8@ms'},
});

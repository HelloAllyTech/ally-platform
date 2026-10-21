import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Image, Pressable, ScrollView, Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {
  useRecordBranchingResultMutation,
  useStartTrackItemMutation,
} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {
  BranchingNode,
  BranchingOutcome,
  BranchingRecapEntry,
  BranchingResult,
  StartBranchingScenarioItemPayload,
  StartTrackItemResponse,
  TrackItemCompletionResult,
  TrackItemType,
} from '@/types';
import {getTimeUntil} from '@/utils';

export interface BranchingScenarioPlayerProps {
  payload: StartBranchingScenarioItemPayload;
  itemId: string;
  onCompleted: (result: TrackItemCompletionResult) => void;
  onRequestNext: () => void;
  /** Leave the item for the course overview (the exhausted screen's exit). */
  onBack: () => void;
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

const UNIT_KEYS = {
  minute: 'untilMinutes',
  hour: 'untilHours',
  day: 'untilDays',
} as const;

/** The round is spent: what the learner reached, and when more opens. */
interface Pause {
  nextRoundAt: string | null;
  recap: BranchingRecapEntry[];
}

const pauseFrom = (source: {
  exhausted: boolean;
  nextRoundAt: string | null;
  recap: BranchingRecapEntry[];
}): Pause | null =>
  source.exhausted
    ? {nextRoundAt: source.nextRoundAt, recap: source.recap ?? []}
    : null;

/**
 * Branching scenario: the learner reads a scene, picks a reply, and lives the
 * next scene. The whole graph arrives in the start payload and is walked
 * locally; only the finished path goes back, and the server's score (never a
 * local one) is what this shows.
 *
 * A choice is final within a run — there is no back, so the consequence lands.
 * "Try again" restarts from the first scene.
 *
 * Running out of attempts is a pause, not a dead end: the learner sees what
 * they reached, and once `nextRoundAt` passes a fresh round of attempts opens
 * (re-fetched from the server, never assumed locally).
 */
export const BranchingScenarioPlayer: React.FC<
  BranchingScenarioPlayerProps
> = ({payload, itemId, onCompleted, onRequestNext, onBack}) => {
  const {t} = useTranslate();
  const [recordResult, {isLoading: isSaving}] =
    useRecordBranchingResultMutation();
  const [startItem, {isLoading: isStarting}] = useStartTrackItemMutation();

  // The start payload, replaced when a new round is fetched.
  const [data, setData] = useState(payload);
  const nodesById = useMemo(
    () => new Map(data.nodes.map(node => [node.id, node])),
    [data.nodes],
  );
  const endingCount = useMemo(
    () => data.nodes.filter(n => !n.choices?.length).length,
    [data.nodes],
  );

  const [nodeId, setNodeId] = useState(data.startNodeId);
  const [path, setPath] = useState<string[]>([]);
  const [result, setResult] = useState<BranchingResult | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  // Exhausted but the start payload could not be re-fetched: say it plainly.
  const [plainExhausted, setPlainExhausted] = useState(false);
  const [pause, setPause] = useState<Pause | null>(() => pauseFrom(payload));
  const [roundLoadFailed, setRoundLoadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [endingsSeen, setEndingsSeen] = useState(data.endingsReached.length);
  // Once the item is complete a replay costs nothing, so it is never gated.
  const [replayFree, setReplayFree] = useState(data.completed);

  const node = nodesById.get(nodeId);
  const isEnding = !!node && !node.choices?.length;
  const gated = data.passScore !== null;

  const nextRoundMs = pause?.nextRoundAt ? Date.parse(pause.nextRoundAt) : NaN;
  const roundOpen = !Number.isNaN(nextRoundMs) && now >= nextRoundMs;

  // Minute resolution is enough for "about 23 hours"; the timer also lands on
  // the exact moment the new round opens.
  useEffect(() => {
    if (Number.isNaN(nextRoundMs) || Date.now() >= nextRoundMs) return;
    const id = setTimeout(
      () => setNow(Date.now()),
      Math.min(60_000, nextRoundMs - Date.now()),
    );
    return () => clearTimeout(id);
  }, [nextRoundMs, now]);

  const chosenText = useCallback(
    (index: number) => {
      // Text of the choice made at step `index` of the path.
      let current = nodesById.get(data.startNodeId);
      for (let i = 0; i <= index && current; i++) {
        const choice = current.choices?.find(c => c.id === path[i]);
        if (i === index) return choice?.text ?? '';
        current = choice ? nodesById.get(choice.nextNodeId) : undefined;
      }
      return '';
    },
    [nodesById, path, data.startNodeId],
  );

  const enterPause = useCallback((spent: Pause) => {
    setNow(Date.now());
    setPause(spent);
  }, []);

  const resetRun = useCallback((startNodeId: string) => {
    setNodeId(startNodeId);
    setPath([]);
    setResult(null);
    setSaveFailed(false);
    setPlainExhausted(false);
  }, []);

  // Adopt a freshly fetched start payload: a spent round pauses, an open one
  // starts over from the first scene.
  const applyFresh = useCallback(
    (fresh: StartTrackItemResponse) => {
      if (fresh.type !== TrackItemType.BRANCHING_SCENARIO) return;
      setData(fresh);
      setEndingsSeen(fresh.endingsReached.length);
      setReplayFree(fresh.completed);
      const spent = pauseFrom(fresh);
      if (spent) enterPause(spent);
      else setPause(null);
      resetRun(fresh.startNodeId);
    },
    [enterPause, resetRun],
  );

  const handleStartNewRound = async () => {
    setRoundLoadFailed(false);
    try {
      applyFresh(await startItem({itemId}).unwrap());
    } catch {
      setRoundLoadFailed(true);
    }
  };

  const submit = useCallback(
    async (finalPath: string[]) => {
      setSaveFailed(false);
      try {
        const res = await recordResult({itemId, path: finalPath}).unwrap();
        const spent = pauseFrom(res);
        if (spent) enterPause(spent);
        setResult(res);
        setEndingsSeen(res.endingsReached.length);
        if (res.itemCompleted) setReplayFree(true);
        if ((res.passed || res.itemCompleted) && res.completion) {
          onCompleted(res.completion);
        }
      } catch (error) {
        if (isAttemptsExhaustedError(error)) {
          // The start payload carries nextRoundAt and the recap.
          try {
            applyFresh(await startItem({itemId}).unwrap());
          } catch {
            setPlainExhausted(true);
          }
        } else {
          setSaveFailed(true);
        }
      }
    },
    [itemId, onCompleted, recordResult, startItem, applyFresh, enterPause],
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

  const handleRestart = () => resetRun(data.startNodeId);

  const exhaustedMessage = (
    <Text style={styles.notice} testID="branching-exhausted-plain">
      {t('courses.branching.attemptsUsedUp')}
    </Text>
  );

  const renderOutcomeBadge = (outcome?: BranchingOutcome) =>
    outcome ? (
      <View
        style={[styles.badge, {backgroundColor: OUTCOME_COLORS[outcome].bg}]}>
        <Text style={[styles.badgeText, {color: OUTCOME_COLORS[outcome].fg}]}>
          {t(`courses.branching.outcome.${outcome}`)}
        </Text>
      </View>
    ) : null;

  if (pause) {
    const until = roundOpen ? null : getTimeUntil(nextRoundMs, now);
    const nextRoundLine = until
      ? t('courses.branching.newRoundIn', {
          time: t(`courses.branching.${UNIT_KEYS[until.unit]}`, {
            count: until.count,
          }),
        })
      : roundOpen
        ? t('courses.branching.newRoundReady')
        : t('courses.branching.newRoundLater');

    return (
      <ScrollView
        contentContainerStyle={styles.content}
        testID="branching-player">
        <Text
          style={styles.exhaustedTitle}
          accessibilityRole="header"
          testID="branching-exhausted">
          {t('courses.branching.exhaustedTitle')}
        </Text>
        {/* Not a live region: the minute-by-minute change is not announced. */}
        <Text style={styles.sceneText} testID="branching-next-round">
          {nextRoundLine}
        </Text>

        {pause.recap.length > 0 ? (
          <>
            <Text style={styles.recapHeading} accessibilityRole="header">
              {t('courses.branching.whatYouReached')}
            </Text>
            <View
              style={styles.recapList}
              accessibilityRole="list"
              accessibilityLabel={t('courses.branching.recapLabel')}>
              {pause.recap.map((entry, i) => {
                const ending = nodesById.get(entry.endingNodeId);
                const outcomeLabel = ending?.outcome
                  ? t(`courses.branching.outcome.${ending.outcome}`)
                  : '';
                const scoreLabel =
                  data.passScore !== null
                    ? t('courses.branching.score', {score: entry.score})
                    : '';
                return (
                  <View
                    key={`${entry.at}-${i}`}
                    style={styles.recapRow}
                    testID="branching-recap-row"
                    accessible
                    accessibilityLabel={[
                      outcomeLabel,
                      ending?.text,
                      scoreLabel,
                      ending?.takeaway,
                    ]
                      .filter(Boolean)
                      .join('. ')}>
                    {renderOutcomeBadge(ending?.outcome)}
                    {ending ? (
                      <Text style={styles.sceneText}>{ending.text}</Text>
                    ) : null}
                    {scoreLabel ? (
                      <Text style={styles.scoreMeta}>{scoreLabel}</Text>
                    ) : null}
                    {ending?.takeaway ? (
                      <Text style={styles.takeaway}>{ending.takeaway}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        {roundLoadFailed ? (
          <Text style={styles.notice} accessibilityRole="alert">
            {t('courses.player.loadFailed')}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {roundOpen ? (
            <Button
              testID="branching-start-round"
              label={t('courses.branching.startNewRound')}
              onPress={handleStartNewRound}
              isLoading={isStarting}
            />
          ) : null}
          <Button
            testID="branching-back"
            label={t('courses.player.backToCourse')}
            variant={roundOpen ? 'secondary' : 'primary'}
            onPress={onBack}
          />
        </View>
      </ScrollView>
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
    const passScore = result ? result.passScore : data.passScore;
    const canRetry =
      replayFree ||
      !result ||
      result.attemptsLeft === null ||
      result.attemptsLeft > 0;
    const showScore = result !== null && passScore !== null;
    const done = !!result && (result.passed || result.itemCompleted);

    return (
      <>
        {renderOutcomeBadge(outcome)}
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
        {plainExhausted ? exhaustedMessage : null}

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
      {path.length === 0 && data.intro ? (
        <Text style={styles.intro}>{data.intro}</Text>
      ) : null}
      {path.length === 0 && endingsSeen > 0 && endingCount > 0 ? (
        <Text style={styles.progressNote} testID="branching-endings-seen">
          {t('courses.branching.endingsSeen', {
            seen: endingsSeen,
            total: endingCount,
          })}
          {gated && data.bestScore !== null
            ? ` · ${t('courses.branching.bestScore', {
                score: data.bestScore,
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
  exhaustedTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  recapHeading: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '8@ms',
  },
  recapList: {gap: '10@ms'},
  recapRow: {
    gap: '8@ms',
    borderWidth: 1.5,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '12@ms',
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

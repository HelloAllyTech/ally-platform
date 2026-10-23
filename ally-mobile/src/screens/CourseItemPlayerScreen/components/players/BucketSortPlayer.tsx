import React, {useCallback, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {
  usePlaceBucketSortItemMutation,
  useRestartBucketSortMutation,
  useStartTrackItemMutation,
} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {
  BucketSortFeedback,
  StartBucketSortItemPayload,
  TrackItemCompletionResult,
  TrackItemType,
} from '@/types';

export interface BucketSortPlayerProps {
  payload: StartBucketSortItemPayload;
  itemId: string;
  onCompleted: (result: TrackItemCompletionResult) => void;
  onRequestNext: () => void;
}

/**
 * Bucket sort: one item at a time, placed by tapping the bucket it belongs in.
 * The server owns the answer key, so every placement is a round trip, and what
 * comes back — verdict, the right bucket, the author's explanation — is shown
 * before the next item appears. A wrong guess is deliberately final: the first
 * placement is what the course learns from, and after the feedback the item
 * sits in its correct bucket.
 *
 * The completion the last placement earns is held until the learner has read
 * the feedback and tapped "See results". The server has already recorded it;
 * reporting it opens the course-complete celebration, which would otherwise
 * cover the final item's feedback and the results.
 */
export const BucketSortPlayer: React.FC<BucketSortPlayerProps> = ({
  payload,
  itemId,
  onCompleted,
  onRequestNext,
}) => {
  const {t} = useTranslate();
  const [placeItem, {isLoading: isPlacing}] = usePlaceBucketSortItemMutation();
  const [restart, {isLoading: isRestarting}] = useRestartBucketSortMutation();
  const [startItem] = useStartTrackItemMutation();

  const [data, setData] = useState(payload);
  const [answered, setAnswered] = useState<Record<string, BucketSortFeedback>>(
    payload.bucketSort.answered,
  );
  /** The item whose feedback is on screen; the next item waits behind "Next". */
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pendingCompletion = useRef<TrackItemCompletionResult | null>(null);

  const {buckets, items} = data.bucketSort;
  const bucketName = useMemo(
    () => new Map(buckets.map(b => [b.id, b.label])),
    [buckets],
  );
  const placedCount = Object.keys(answered).length;
  const reviewing = reviewingId
    ? items.find(i => i.id === reviewingId)
    : undefined;
  const feedback = reviewingId ? answered[reviewingId] : undefined;
  const current = reviewing ?? items.find(i => !answered[i.id]);
  const finished = placedCount === items.length && !reviewing;

  const place = useCallback(
    async (sortItemId: string, bucketId: string) => {
      if (isPlacing || reviewingId) return;
      setFailed(false);
      try {
        const result = await placeItem({
          itemId,
          sortItemId,
          bucketId,
        }).unwrap();
        setAnswered(prev => ({
          ...prev,
          [sortItemId]: {
            correct: result.correct,
            placedBucketId: result.placedBucketId,
            correctBucketId: result.correctBucketId,
            explanation: result.explanation,
          },
        }));
        setReviewingId(sortItemId);
        if (result.completion) pendingCompletion.current = result.completion;
      } catch {
        setFailed(true);
      }
    },
    [isPlacing, reviewingId, placeItem, itemId],
  );

  const handleNext = () => {
    setReviewingId(null);
    if (pendingCompletion.current) {
      onCompleted(pendingCompletion.current);
      pendingCompletion.current = null;
    }
  };

  const handleRestart = async () => {
    setFailed(false);
    try {
      await restart({itemId}).unwrap();
      const fresh = await startItem({itemId}).unwrap();
      if (fresh.type !== TrackItemType.BUCKET_SORT) return;
      setData(fresh);
      setAnswered(fresh.bucketSort.answered);
      setReviewingId(null);
    } catch {
      setFailed(true);
    }
  };

  const firstTryPct = Math.round(
    (Object.values(answered).filter(a => a.correct).length /
      Math.max(items.length, 1)) *
      100,
  );
  const missed = items.filter(i => answered[i.id] && !answered[i.id].correct);
  const canPlace = !!current && !reviewing && !isPlacing;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      testID="bucket-sort-player">
      {data.bucketSort.intro ? (
        <Text style={styles.intro}>{data.bucketSort.intro}</Text>
      ) : null}

      {!finished && current ? (
        <>
          <Text style={styles.progress} testID="bucket-sort-progress">
            {t('courses.bucketSort.progress', {
              placed: placedCount,
              total: items.length,
            })}
          </Text>
          <Text style={styles.ask}>
            {t('courses.bucketSort.whereDoesItGo')}
          </Text>
          <View style={styles.itemCard} testID="bucket-sort-item">
            <Text style={styles.itemText}>{current.text}</Text>
          </View>
          {!reviewing ? (
            <Text style={styles.hint}>{t('courses.bucketSort.tapHint')}</Text>
          ) : null}
        </>
      ) : null}

      {buckets.map(bucket => {
        const settled = items.filter(
          i =>
            answered[i.id]?.correctBucketId === bucket.id &&
            i.id !== reviewingId,
        );
        const isTarget = feedback?.correctBucketId === bucket.id;
        const isWrong =
          !!feedback &&
          !feedback.correct &&
          feedback.placedBucketId === bucket.id;
        return (
          <Pressable
            key={bucket.id}
            testID={`bucket-${bucket.id}`}
            accessibilityRole="button"
            accessibilityState={{disabled: !canPlace}}
            accessibilityLabel={
              current
                ? t('courses.bucketSort.bucketA11y', {
                    item: current.text,
                    bucket: bucket.label,
                  })
                : bucket.label
            }
            disabled={!canPlace}
            onPress={() => current && place(current.id, bucket.id)}
            style={({pressed}) => [
              styles.bucket,
              pressed && canPlace && styles.bucketPressed,
              isTarget && styles.bucketRight,
              isWrong && styles.bucketWrong,
            ]}>
            <Text style={styles.bucketLabel}>{bucket.label}</Text>
            {bucket.description ? (
              <Text style={styles.bucketDescription}>{bucket.description}</Text>
            ) : null}
            {isTarget && current ? (
              <Text style={styles.settledActive}>{current.text}</Text>
            ) : null}
            {/* The red card is the wrong pick for THIS item, not for the ones
                already settled in it, so show which item was misplaced. */}
            {isWrong && current ? (
              <Text
                testID="bucket-sort-misplaced"
                style={[styles.settledActive, styles.misplaced]}>
                {current.text}
              </Text>
            ) : null}
            {settled.map(i => (
              <Text key={i.id} style={styles.settled}>
                {i.text}
              </Text>
            ))}
          </Pressable>
        );
      })}

      {failed ? (
        <Text style={styles.notice} accessibilityRole="alert">
          {t('courses.bucketSort.placeFailed')}
        </Text>
      ) : null}

      {reviewing && feedback ? (
        <View
          testID="bucket-sort-feedback"
          accessibilityLiveRegion="polite"
          style={[
            styles.feedback,
            feedback.correct ? styles.feedbackRight : styles.feedbackWrong,
          ]}>
          <Text style={styles.feedbackTitle}>
            {feedback.correct
              ? t('courses.bucketSort.correct')
              : t('courses.bucketSort.notQuite')}
          </Text>
          {!feedback.correct ? (
            <Text style={styles.feedbackText}>
              {`${t('courses.bucketSort.youChose', {
                bucket: bucketName.get(feedback.placedBucketId),
              })} ${t('courses.bucketSort.belongsIn', {
                bucket: bucketName.get(feedback.correctBucketId),
              })}`}
            </Text>
          ) : null}
          {feedback.explanation ? (
            <Text style={styles.feedbackText}>{feedback.explanation}</Text>
          ) : null}
          <Button
            testID="bucket-sort-next"
            label={
              placedCount === items.length
                ? t('courses.bucketSort.seeResults')
                : t('courses.bucketSort.next')
            }
            onPress={handleNext}
          />
        </View>
      ) : null}

      {finished ? (
        <View style={styles.results} testID="bucket-sort-results">
          <Text style={styles.resultsTitle}>
            {t('courses.bucketSort.resultsHeading')}
          </Text>
          <Text style={styles.feedbackText}>
            {t('courses.bucketSort.firstTry', {pct: firstTryPct})}
          </Text>
          {data.bestFirstTryPct !== null ? (
            <Text style={styles.hint}>
              {t('courses.bucketSort.best', {pct: data.bestFirstTryPct})}
            </Text>
          ) : null}
          {missed.length === 0 ? (
            <Text style={styles.feedbackText}>
              {t('courses.bucketSort.allRight')}
            </Text>
          ) : (
            <>
              <Text style={styles.recapHeading}>
                {t('courses.bucketSort.reviewHeading')}
              </Text>
              {missed.map(i => (
                <View key={i.id} style={styles.missed}>
                  <Text style={styles.itemText}>{i.text}</Text>
                  <Text style={styles.hint}>
                    {t('courses.bucketSort.belongsIn', {
                      bucket: bucketName.get(answered[i.id].correctBucketId),
                    })}
                  </Text>
                  {answered[i.id].explanation ? (
                    <Text style={styles.hint}>
                      {answered[i.id].explanation}
                    </Text>
                  ) : null}
                </View>
              ))}
            </>
          )}
          <View style={styles.actions}>
            <Button
              testID="bucket-sort-continue"
              label={t('courses.bucketSort.continue')}
              onPress={onRequestNext}
            />
            <Button
              testID="bucket-sort-restart"
              label={t('courses.bucketSort.practiceAgain')}
              variant="secondary"
              onPress={handleRestart}
              isLoading={isRestarting}
            />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
};

const body = {
  ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  ...typography.body.medium,
  fontWeight: fontWeights.regular,
};

const styles = ScaledSheet.create({
  content: {
    flexGrow: 1,
    gap: '12@ms',
    paddingHorizontal: '16@ms',
    paddingVertical: '16@ms',
  },
  intro: {...body, color: colors.ds.typography.mediumEmphasis},
  progress: {
    ...body,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  ask: {
    ...body,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  itemCard: {
    borderWidth: 2,
    borderColor: colors.ds.theme.primary,
    borderRadius: '12@ms',
    backgroundColor: colors.ds.neutral.white,
    padding: '16@ms',
  },
  itemText: {
    ...body,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  hint: {
    ...body,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  bucket: {
    minHeight: '56@ms',
    gap: '6@ms',
    borderWidth: 1.5,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    backgroundColor: colors.ds.neutral.white,
    padding: '14@ms',
  },
  bucketPressed: {
    borderColor: colors.ds.theme.primary,
    backgroundColor: colors.ds.blue[50],
  },
  bucketRight: {
    borderColor: colors.ds.feedback.onSuccessContainer,
    backgroundColor: colors.ds.feedback.successContainer,
  },
  bucketWrong: {
    borderColor: colors.ds.feedback.onErrorContainer,
    backgroundColor: colors.ds.feedback.errorContainer,
  },
  bucketLabel: {
    ...body,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  bucketDescription: {
    ...body,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  settled: {
    ...body,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
    backgroundColor: colors.ds.grey[100],
    borderRadius: '6@ms',
    paddingHorizontal: '8@ms',
    paddingVertical: '4@ms',
  },
  settledActive: {
    ...body,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    backgroundColor: colors.ds.neutral.white,
    borderRadius: '6@ms',
    paddingHorizontal: '8@ms',
    paddingVertical: '4@ms',
  },
  misplaced: {
    textDecorationLine: 'line-through',
    color: colors.ds.feedback.onErrorContainer,
  },
  notice: {
    ...body,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  feedback: {gap: '8@ms', borderRadius: '12@ms', padding: '14@ms'},
  feedbackRight: {backgroundColor: colors.ds.feedback.successContainer},
  feedbackWrong: {backgroundColor: colors.ds.feedback.errorContainer},
  feedbackTitle: {
    ...body,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  feedbackText: {...body, color: colors.ds.typography.highEmphasis},
  results: {
    gap: '10@ms',
    borderWidth: 1.5,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    backgroundColor: colors.ds.neutral.white,
    padding: '16@ms',
  },
  resultsTitle: {
    ...body,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  recapHeading: {
    ...body,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '4@ms',
  },
  missed: {
    gap: '4@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.ds.feedback.errorContainer,
    padding: '12@ms',
  },
  actions: {gap: '10@ms', marginTop: '8@ms'},
});

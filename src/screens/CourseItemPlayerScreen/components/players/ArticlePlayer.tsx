import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {TickRoundIcon} from '@/assets';
import {Button, RichText} from '@/components';
import {useTranslate} from '@/hooks';
import {useMarkArticleReadMutation} from '@/services';
import {colors} from '@/theme';
import {
  StartArticleItemPayload,
  SubmitArticleQuestionAnswerResult,
  TrackItemCompletionResult,
} from '@/types';
import {splitArticleHtml} from '@/utils';

import {ArticleQuestionCard} from './ArticleQuestionCard';

export interface ArticlePlayerProps {
  payload: StartArticleItemPayload;
  itemId: string;
  /** Whether the item is already completed (resumed). */
  alreadyCompleted: boolean;
  onCompleted: (result: TrackItemCompletionResult) => void;
}

/** Scroll fraction (0-1) past which the article counts as "read". */
const READ_SCROLL_THRESHOLD = 0.95;
/** If the article doesn't scroll, auto-eligible after this many ms. */
const NO_SCROLL_READY_MS = 3000;

/**
 * Article item: renders sanitized HTML with a thin scroll-progress bar and
 * a mark-read affordance that unlocks once the reader reaches ~95% scroll,
 * or after a few seconds if the content is too short to scroll. Mirrors
 * ally-web's `ArticleItemPlayer` (the font-size stepper is a deliberate v1
 * scope-cut — `RichText` has no scale knob to hook it into).
 *
 * An article may also carry inline questions, anchored between its prose
 * blocks. Those are the article's completion rule when present: the server
 * completes the item on the last answer (and refuses mark-as-read while any
 * are outstanding), so the reader has to work through them rather than
 * scrolling past. The body is split on their placeholders and the segments
 * rendered in order.
 */
export const ArticlePlayer: React.FC<ArticlePlayerProps> = ({
  payload,
  itemId,
  alreadyCompleted,
  onCompleted,
}) => {
  const {t} = useTranslate();
  const [scrollPct, setScrollPct] = useState(0);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [marked, setMarked] = useState(alreadyCompleted);
  const [markArticleRead, {isLoading}] = useMarkArticleReadMutation();

  const segments = useMemo(
    () => splitArticleHtml(payload.html, payload.questions ?? []),
    [payload.html, payload.questions],
  );
  /**
   * Only the questions the article actually shows. Counting
   * `payload.questions` instead would hold the footer shut forever on a
   * translated body that lost a placeholder — the server counts the rendered
   * set for the same reason.
   */
  const shownQuestions = useMemo(
    () =>
      segments.flatMap(segment =>
        segment.kind === 'question' ? [segment.question] : [],
      ),
    [segments],
  );
  // Seeded from the payload so a resumed article counts what was answered
  // before, then advanced locally as each card reports back.
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(
    () =>
      new Set(
        (payload.questions ?? [])
          .filter(question => question.answered)
          .map(question => question.id),
      ),
  );
  const unansweredCount = shownQuestions.filter(
    question => !answeredIds.has(question.id),
  ).length;

  const handleQuestionAnswered = (
    questionId: string,
    result: SubmitArticleQuestionAnswerResult,
  ) => {
    setAnsweredIds(prev => new Set(prev).add(questionId));
    // The last answer completes the article server-side; mirror that here so
    // the outline and the footer move without a round trip.
    if (result.completion?.completed) {
      setMarked(true);
      onCompleted(result.completion);
    }
  };

  const contentHeightRef = useRef(0);
  const layoutHeightRef = useRef(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const evaluateScrollability = useCallback(() => {
    const contentH = contentHeightRef.current;
    const layoutH = layoutHeightRef.current;
    if (
      contentH > 0 &&
      layoutH > 0 &&
      contentH <= layoutH &&
      !fallbackTimerRef.current
    ) {
      fallbackTimerRef.current = setTimeout(
        () => setReachedEnd(true),
        NO_SCROLL_READY_MS,
      );
    }
  }, []);

  useEffect(
    () => () => {
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    },
    [],
  );

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {contentOffset, contentSize, layoutMeasurement} = e.nativeEvent;
    const max = contentSize.height - layoutMeasurement.height;
    const pct =
      max <= 0 ? 100 : Math.min(100, Math.round((contentOffset.y / max) * 100));
    setScrollPct(pct);
    if (pct >= READ_SCROLL_THRESHOLD * 100) setReachedEnd(true);
  };

  const handleContentSizeChange = (_width: number, height: number) => {
    contentHeightRef.current = height;
    evaluateScrollability();
  };

  const handleLayout = (e: LayoutChangeEvent) => {
    layoutHeightRef.current = e.nativeEvent.layout.height;
    evaluateScrollability();
  };

  const canMark =
    (reachedEnd || scrollPct >= READ_SCROLL_THRESHOLD * 100) &&
    unansweredCount === 0;

  const handleMarkRead = async () => {
    if (marked || isLoading) return;
    try {
      const result = await markArticleRead({itemId}).unwrap();
      setMarked(true);
      onCompleted(result);
    } catch {
      // Button stays available so the learner can retry.
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, {width: `${scrollPct}%`}]} />
      </View>

      <ScrollView
        testID="article-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onContentSizeChange={handleContentSizeChange}
        onLayout={handleLayout}>
        {segments.map(segment =>
          segment.kind === 'html' ? (
            <RichText key={segment.key} html={segment.html} />
          ) : (
            <ArticleQuestionCard
              key={segment.key}
              itemId={itemId}
              question={segment.question}
              onAnswered={result =>
                handleQuestionAnswered(segment.question.id, result)
              }
            />
          ),
        )}
      </ScrollView>

      <View style={styles.footer}>
        {marked ? (
          <View style={styles.readChip}>
            <TickRoundIcon
              width={16}
              height={16}
              color={colors.ds.green[700]}
            />
            <Text style={styles.readChipText}>{t('courses.article.read')}</Text>
          </View>
        ) : (
          <Button
            testID="article-mark-read"
            label={
              unansweredCount > 0
                ? t(
                    unansweredCount === 1
                      ? 'courses.article.answerQuestionToContinue'
                      : 'courses.article.answerQuestionsToContinue',
                  )
                : canMark
                  ? t('courses.article.markRead')
                  : t('courses.article.keepReading')
            }
            onPress={handleMarkRead}
            isDisabled={!canMark}
            isLoading={isLoading}
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
  progressTrack: {
    height: '3@ms',
    backgroundColor: colors.ds.grey[100],
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.ds.theme.primary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: '16@ms',
  },
  footer: {
    borderTopWidth: 0.5,
    borderTopColor: colors.ds.stroke.primary,
    padding: '16@ms',
    alignItems: 'center',
  },
  readChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
  },
  readChipText: {
    color: colors.ds.green[700],
  },
});

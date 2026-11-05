import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  LayoutChangeEvent,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ChevronRight, TickRoundIcon} from '@/assets';
import {Button, RichText} from '@/components';
import {useTranslate} from '@/hooks';
import {useMarkArticleReadMutation} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {
  ArticleResource,
  StartArticleItemPayload,
  SubmitArticleQuestionAnswerResult,
  TrackItemCompletionResult,
} from '@/types';
import {splitArticleHtml} from '@/utils';

import {ArticleQuestionCard} from './ArticleQuestionCard';
import {ExternalResourceSheet} from './ExternalResourceSheet';

/** Android's WebView frequently cannot render these inline — hand off to the OS instead. */
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx'];
const isDocumentUrl = (url: string): boolean => {
  const path = url.split('?')[0].split('#')[0].toLowerCase();
  return DOCUMENT_EXTENSIONS.some(ext => path.endsWith(ext));
};

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
  const [activeResource, setActiveResource] = useState<ArticleResource | null>(
    null,
  );

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

  // Reached-end is tracked against a sentinel placed right after the article
  // body (before the Resources section, when there is one) — not against
  // total scroll-content height. Resources are supplementary, never required
  // reading, so scrolling past them must never be a precondition for
  // completion (mirrors ally-web's IntersectionObserver-sentinel approach).
  const sentinelYRef = useRef(0);
  const layoutHeightRef = useRef(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const evaluateScrollability = useCallback(() => {
    const sentinelY = sentinelYRef.current;
    const layoutH = layoutHeightRef.current;
    if (
      sentinelY > 0 &&
      layoutH > 0 &&
      sentinelY <= layoutH &&
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
    const sentinelY = sentinelYRef.current;
    if (
      sentinelY > 0 &&
      contentOffset.y + layoutMeasurement.height >= sentinelY
    ) {
      setReachedEnd(true);
    }
  };

  const handleSentinelLayout = (e: LayoutChangeEvent) => {
    sentinelYRef.current = e.nativeEvent.layout.y;
    evaluateScrollability();
  };

  const handleLayout = (e: LayoutChangeEvent) => {
    layoutHeightRef.current = e.nativeEvent.layout.height;
    evaluateScrollability();
  };

  const handleResourcePress = (resource: ArticleResource) => {
    if (isDocumentUrl(resource.url)) {
      Linking.openURL(resource.url);
      return;
    }
    setActiveResource(resource);
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
        <View testID="article-end-sentinel" onLayout={handleSentinelLayout} />

        {!!payload.resources?.length && (
          <View style={styles.resourcesSection}>
            <Text style={styles.resourcesHeading}>
              {t('courses.article.resourcesHeading')}
            </Text>
            {payload.resources.map(resource => (
              <TouchableOpacity
                key={resource.id}
                style={styles.resourceRow}
                onPress={() => handleResourcePress(resource)}
                accessibilityRole="button">
                <Text style={styles.resourceTitle} numberOfLines={1}>
                  {resource.title}
                </Text>
                <ChevronRight />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {activeResource && (
        <ExternalResourceSheet
          resource={activeResource}
          onClose={() => setActiveResource(null)}
        />
      )}

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
  resourcesSection: {
    marginTop: '24@ms',
    borderTopWidth: 1,
    borderTopColor: colors.ds.stroke.primary,
    paddingTop: '16@ms',
    gap: '8@ms',
  },
  resourcesHeading: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '4@ms',
  },
  resourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '10@ms',
    paddingHorizontal: '12@ms',
    paddingVertical: '10@ms',
  },
  resourceTitle: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.theme.primary,
    flex: 1,
  },
});

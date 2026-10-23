import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  FlatList,
  Keyboard,
  LayoutChangeEvent,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useTranslate} from '@/hooks';
import {colors} from '@/theme';
import {SimulationSummaryData} from '@/types';

import {CitationsTable} from '../AskAI/ChatElements';
import {AskAIChatMessage, ChatMessageRole} from '../AskAI/types';
import {useAskAIChat} from '../AskAI/useAskAIChat';
import {DebriefReplyInput} from './DebriefReplyInput';
import {styles} from './styles';
import {SupervisorNote} from './SupervisorNote';

interface DebriefTabProps {
  scenarioSessionId: string;
  simulationDetails: SimulationSummaryData | null;
  /** True once the feedback poll loop has given up — stops showing "still writing". */
  retryLimitReached: boolean;
  /**
   * Opens the anchored moment by switching to the Transcript tab. Undefined
   * when that tab is off for this roleplay (see `feedbackTabs.transcript`).
   */
  onOpenMoment?: (messageId: string) => void;
  /**
   * Read-only: show the note alone, with no reply thread and no composer. Set
   * when the screen was opened from Logs (`fromLogs`), where the debrief is
   * being read back rather than received. The thread is keyed by session id, so
   * an admin reviewing someone else's roleplay would otherwise be typing into
   * that learner's own conversation with Ally.
   */
  readOnly?: boolean;
}

const NoteSkeleton = () => (
  <View style={styles.skeletonRow} testID="debrief-note-skeleton">
    <View style={styles.skeletonAvatar} />
    <View style={styles.skeletonLines}>
      <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineWide]} />
      <View style={[styles.skeletonLine, styles.skeletonLineMedium]} />
    </View>
  </View>
);

/**
 * A timestamp Ally wrote to point at a moment in the transcript, e.g. `[4:12]`.
 * The chat prompt tells it to format these exactly as the transcript does and
 * never to invent one; the backend resolves each into a Citation against the
 * real transcript row.
 */
const TIMESTAMP = /\[(\d{1,2}:\d{2})\]/g;

/** Inline `**bold**`, matching how the note itself renders emphasis. */
const REPLY_BOLD = /\*\*(.+?)\*\*/g;

type ReplySegment =
  | {type: 'text'; value: string}
  | {type: 'bold'; value: string}
  | {type: 'timestamp'; value: string};

const parseReplySegments = (line: string): ReplySegment[] => {
  const segments: ReplySegment[] = [];
  const pattern = new RegExp(`${TIMESTAMP.source}|${REPLY_BOLD.source}`, 'g');
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > cursor) {
      segments.push({type: 'text', value: line.slice(cursor, match.index)});
    }
    if (match[1] !== undefined) {
      segments.push({type: 'timestamp', value: match[1]});
    } else if (match[2] !== undefined) {
      segments.push({type: 'bold', value: match[2]});
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < line.length) {
    segments.push({type: 'text', value: line.slice(cursor)});
  }
  return segments.length ? segments : [{type: 'text', value: line}];
};

/**
 * A reply in the conversation the note opened. Deliberately plainer than the
 * note itself: the note is the thing being read, the replies are a
 * conversation about it — mirrors ally-web's ReplyBubble.
 *
 * Ally is told to ground every factual claim in the transcript, so its replies
 * carry timestamps. Those used to render as literal `[4:12]` text and the
 * resolved citations were dropped on the floor — the backend computed them and
 * nothing displayed them.
 */
const ReplyBubble: React.FC<{
  message: AskAIChatMessage;
  clientName?: string;
  onOpenMoment?: (messageId: string) => void;
}> = ({message, clientName, onOpenMoment}) => {
  const {t} = useTranslate();

  if (message.role === ChatMessageRole.USER) {
    return (
      <View style={styles.learnerBubble}>
        <Text style={styles.learnerBubbleText}>{message.content}</Text>
      </View>
    );
  }

  const citations = message.citations ?? [];
  // A timestamp is only worth making tappable if the backend actually resolved
  // it to a transcript row; an unresolved one stays plain text.
  const citationByTimestamp = new Map(
    citations.map(citation => [citation.timestamp, citation]),
  );
  const showCitations = !message.isStreaming && citations.length > 0;
  const clientLabel = clientName
    ? `${clientName} (${t('transcription.aiClientSuffix')})`
    : t('transcription.aiClientSuffix');

  return (
    <View style={styles.allyReplyRow}>
      <Text style={styles.allyReplyText}>
        {parseReplySegments(message.content).map((segment, segmentIndex) => {
          if (segment.type === 'bold') {
            return (
              <Text key={segmentIndex} style={styles.boldText}>
                {segment.value}
              </Text>
            );
          }
          if (segment.type === 'timestamp') {
            const citation = citationByTimestamp.get(segment.value);
            if (!citation || !onOpenMoment) {
              return <Text key={segmentIndex}>[{segment.value}]</Text>;
            }
            return (
              <Text
                key={segmentIndex}
                style={styles.momentChip}
                onPress={() => onOpenMoment(String(citation.transcriptId))}
                suppressHighlighting>
                {' '}
                {segment.value}{' '}
              </Text>
            );
          }
          return <Text key={segmentIndex}>{segment.value}</Text>;
        })}
      </Text>
      {showCitations && (
        <CitationsTable
          citations={citations}
          clientLabel={clientLabel}
          youLabel={t('transcription.youLabel')}
        />
      )}
    </View>
  );
};

/**
 * The landing surface after a practice session: Ally's debrief note, which
 * the learner can reply to. The note and the replies are one continuous
 * thread rather than a summary with a chat bolted beneath it, mirroring
 * ally-web's DebriefTab.tsx. The reply thread reuses the exact same
 * scenario-session chat session (useAskAIChat / chatSessionManager) the old
 * standalone Ask AI tab called — it is absorbed here, not replaced.
 */
export const DebriefTab: React.FC<DebriefTabProps> = ({
  scenarioSessionId,
  simulationDetails,
  retryLimitReached,
  onOpenMoment,
  readOnly = false,
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Who the simulated client is, so a citation can attribute the line it
  // quotes to a name rather than just "AI Client".
  const clientName = simulationDetails?.scenario?.metadata?.name;

  const {
    messages,
    isStreaming,
    isLoading: isHistoryLoading,
    error,
    sendMessage,
    retry,
  } = useAskAIChat({
    // An empty id is useAskAIChat's own no-op path — it guards loadHistory on a
    // truthy session id — so a read-only debrief never loads the thread.
    scenarioSessionId: readOnly ? '' : scenarioSessionId,
  });

  const flatListRef = useRef<FlatList<AskAIChatMessage>>(null);
  const contentHeightRef = useRef(0);
  const listHeightRef = useRef(0);

  const scrollToBottom = useCallback((animated = true) => {
    const offset = contentHeightRef.current - listHeightRef.current;
    if (offset > 0) {
      flatListRef.current?.scrollToOffset({offset, animated});
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }

    const showSub = Keyboard.addListener('keyboardWillShow', e => {
      setKeyboardHeight(Math.max(0, e.endCoordinates.height - insets.bottom));
      setTimeout(() => scrollToBottom(true), 100);
    });
    const hideSub = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [insets.bottom, scrollToBottom]);

  const handleContentSizeChange = useCallback(
    (_w: number, h: number) => {
      contentHeightRef.current = h;
      scrollToBottom(true);
    },
    [scrollToBottom],
  );

  const handleListLayout = useCallback((e: LayoutChangeEvent) => {
    listHeightRef.current = e.nativeEvent.layout.height;
  }, []);

  const summary = simulationDetails?.details?.summary;
  const note = summary?.feedback?.supervisorNote;
  const errorMessage = summary?.errorMessage;
  // Nothing has landed yet and polling is still going: the evaluation runs
  // asynchronously after the session ends, so "empty" here means "not yet".
  const isGenerating = !note && !errorMessage && !retryLimitReached;

  const renderHeader = useCallback(
    () => (
      <View>
        {isGenerating ? (
          <View>
            <NoteSkeleton />
            <Text style={styles.generatingText}>
              {t('postSim.debrief.generating')}{' '}
              <Text style={styles.generatingHint}>
                {t('postSim.debrief.generatingHint')}
              </Text>
            </Text>
          </View>
        ) : note ? (
          <SupervisorNote
            note={note}
            onOpenMoment={onOpenMoment}
            hideClosing={readOnly}
          />
        ) : (
          // Generation failed, or this session predates the debrief note.
          // Say so plainly rather than showing an empty panel.
          <Text style={styles.failedText}>
            {errorMessage || t('postSim.debrief.failed')}
          </Text>
        )}

        {!readOnly && !!note && messages.length === 0 && !isHistoryLoading && (
          <Text style={styles.replyPromptText}>
            {t('postSim.debrief.replyPrompt')}
          </Text>
        )}
      </View>
    ),
    [
      isGenerating,
      note,
      errorMessage,
      messages.length,
      isHistoryLoading,
      onOpenMoment,
      readOnly,
      t,
    ],
  );

  const renderFooter = useCallback(() => {
    // The only thing in the footer is a chat retry, which a read-only debrief
    // has nothing to retry.
    if (!error || readOnly) {
      return null;
    }
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={retry}
          activeOpacity={0.7}>
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }, [error, readOnly, retry, t]);

  const renderItem = useCallback(
    ({item}: {item: AskAIChatMessage}) => (
      <ReplyBubble
        message={item}
        clientName={clientName}
        onOpenMoment={onOpenMoment}
      />
    ),
    [clientName, onOpenMoment],
  );

  const keyExtractor = useCallback((item: AskAIChatMessage) => item.id, []);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[
          colors.ds.blue[500],
          colors.ds.blue[100],
          colors.ds.brand.logo,
        ]}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 1}}
        style={styles.gradientContainer}>
        <View style={styles.header}>
          <Text style={styles.headerText}>{t('postSim.debrief.header')}</Text>
        </View>
        <View style={styles.contentContainer}>
          <View
            style={[
              styles.content,
              keyboardHeight > 0 && {paddingBottom: keyboardHeight},
            ]}>
            <FlatList
              ref={flatListRef}
              data={messages}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={renderHeader}
              ListFooterComponent={renderFooter}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={handleContentSizeChange}
              onLayout={handleListLayout}
            />
            {!readOnly && !!note && (
              <DebriefReplyInput onSend={sendMessage} disabled={isStreaming} />
            )}
          </View>
        </View>
      </LinearGradient>
    </View>
  );
};

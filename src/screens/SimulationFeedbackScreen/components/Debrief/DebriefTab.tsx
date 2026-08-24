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
 * A reply in the conversation the note opened. Deliberately plainer than the
 * note itself: the note is the thing being read, the replies are a
 * conversation about it — mirrors ally-web's ReplyBubble.
 */
const ReplyBubble: React.FC<{role: ChatMessageRole; content: string}> = ({
  role,
  content,
}) => {
  if (role === ChatMessageRole.USER) {
    return (
      <View style={styles.learnerBubble}>
        <Text style={styles.learnerBubbleText}>{content}</Text>
      </View>
    );
  }
  return (
    <View style={styles.allyReplyRow}>
      <Text style={styles.allyReplyText}>{content}</Text>
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
}) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const {
    messages,
    isStreaming,
    isLoading: isHistoryLoading,
    error,
    sendMessage,
    retry,
  } = useAskAIChat({scenarioSessionId});

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
          <SupervisorNote note={note} onOpenMoment={onOpenMoment} />
        ) : (
          // Generation failed, or this session predates the debrief note.
          // Say so plainly rather than showing an empty panel.
          <Text style={styles.failedText}>
            {errorMessage || t('postSim.debrief.failed')}
          </Text>
        )}

        {!!note && messages.length === 0 && !isHistoryLoading && (
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
      t,
    ],
  );

  const renderFooter = useCallback(() => {
    if (!error) {
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
  }, [error, retry, t]);

  const renderItem = useCallback(
    ({item}: {item: AskAIChatMessage}) => (
      <ReplyBubble role={item.role} content={item.content} />
    ),
    [],
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
            {!!note && (
              <DebriefReplyInput onSend={sendMessage} disabled={isStreaming} />
            )}
          </View>
        </View>
      </LinearGradient>
    </View>
  );
};

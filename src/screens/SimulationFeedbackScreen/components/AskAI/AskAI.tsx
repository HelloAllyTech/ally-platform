import React, {useCallback, useEffect, useRef, useState} from 'react';
import LottieView from 'lottie-react-native';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  LayoutChangeEvent,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {animations, RankBadgeIcon, UpArrowIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {AskAiInitialState} from './AskAiInitialState';
import {styles} from './styles';
import {AskAIChatMessage, ChatMessageRole, Citation} from './types';
import {useAskAIChat} from './useAskAIChat';

// ── Props ───────────────────────────────────────────────────────

interface AskAIProps {
  scenarioSessionId?: string;
}

const MAX_MESSAGE_LENGTH = 2000;

// ── Sub-components ──────────────────────────────────────────────

const UserMessageBubble: React.FC<{message: AskAIChatMessage}> = React.memo(
  ({message}) => (
    <View style={styles.questionBubble}>
      <Text style={styles.questionText}>{message.content}</Text>
    </View>
  ),
);

const getSpeakerLabel = (senderId: number) =>
  senderId === -1 ? 'Client' : 'Counselor';

const CitationsTable: React.FC<{citations: Citation[]}> = React.memo(
  ({citations}) => (
    <View style={styles.citationsContainer}>
      <Text style={styles.citationsHeader}>References</Text>
      {citations.map((citation, index) => (
        <View
          key={citation.transcriptId}
          style={[
            styles.citationRow,
            index % 2 === 1 && styles.citationRowAlt,
          ]}>
          <Text style={styles.citationTimestamp}>{citation.timestamp}</Text>
          <Text style={styles.citationContent}>
            <Text style={styles.citationSpeaker}>
              {getSpeakerLabel(citation.senderId)}:{' '}
            </Text>
            {citation.content}
          </Text>
        </View>
      ))}
    </View>
  ),
);

const AIMessageBubble: React.FC<{message: AskAIChatMessage}> = React.memo(
  ({message}) => {
    const showCitations =
      !message.isStreaming && message.citations && message.citations.length > 0;

    return (
      <View style={styles.responseContainer}>
        <View style={styles.rankBadgeContainer}>
          <LinearGradient
            colors={[colors.ds.blue[50], colors.white]}
            start={{x: 0, y: 0}}
            end={{x: 0, y: 1}}
            style={styles.rankBadgeGradient}>
            <RankBadgeIcon width={9} height={9} />
          </LinearGradient>
        </View>
        <View style={styles.responseTextContainer}>
          <Text style={styles.responseText}>
            {message.content}
            {message.isStreaming ? '▍' : ''}
          </Text>
          {showCitations && <CitationsTable citations={message.citations!} />}
        </View>
      </View>
    );
  },
);

const ThinkingIndicator: React.FC = () => (
  <View style={styles.responseContainer}>
    <LottieView
      source={animations.thinking}
      style={styles.thinkingLottie}
      autoPlay
      loop
      resizeMode="contain"
    />
  </View>
);

// ── Main Component ──────────────────────────────────────────────

export const AskAI: React.FC<AskAIProps> = ({scenarioSessionId}) => {
  const {t} = useTranslate();
  const [inputText, setInputText] = useState('');
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const {
    messages,
    isStreaming,
    isLoading,
    error,
    isInterrupted,
    sendMessage,
    retry,
  } = useAskAIChat({scenarioSessionId});

  const flatListRef = useRef<FlatList<AskAIChatMessage>>(null);
  const contentHeightRef = useRef(0);
  const listHeightRef = useRef(0);

  const [isThinking, setIsThinking] = useState(false);
  const prevMessageCountRef = useRef(messages.length);

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

  // Detect when AI message gets added (thinking -> streaming transition)
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === ChatMessageRole.ASSISTANT) {
        setIsThinking(false);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

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

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed || isStreaming) {
      return;
    }
    sendMessage(trimmed);
    setInputText('');
    setIsThinking(true);
  }, [inputText, isStreaming, sendMessage]);

  const handleRetry = useCallback(() => {
    setIsThinking(true);
    retry();
  }, [retry]);

  const isOverLimit = inputText.length > MAX_MESSAGE_LENGTH;
  const canSend = inputText.trim().length > 0 && !isStreaming && !isOverLimit;

  const renderMessage = useCallback(({item}: {item: AskAIChatMessage}) => {
    if (item.role === ChatMessageRole.USER) {
      return <UserMessageBubble message={item} />;
    }
    return <AIMessageBubble message={item} />;
  }, []);

  const keyExtractor = useCallback((item: AskAIChatMessage) => item.id, []);

  const renderEmptyState = useCallback(
    () => (
      <AskAiInitialState
        onQuestionSelection={message => {
          sendMessage(message);
          setIsThinking(true);
        }}
      />
    ),
    [sendMessage],
  );

  const showThinking = isThinking && !isStreaming && !error;
  const showRetry = !!(error || isInterrupted) && !isStreaming;

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
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerText}>
            {t('SimulationFeedback.askAIHeader')}
          </Text>
        </View>

        <View style={styles.contentContainer}>
          <View
            style={[
              styles.content,
              keyboardHeight > 0 && {paddingBottom: keyboardHeight},
            ]}>
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.ds.blue[500]} />
              </View>
            ) : (
              <>
                {/* Message List */}
                <FlatList
                  ref={flatListRef}
                  data={messages}
                  renderItem={renderMessage}
                  keyExtractor={keyExtractor}
                  style={styles.messageList}
                  contentContainerStyle={[
                    styles.messageListContent,
                    messages.length === 0 && styles.emptyListContent,
                  ]}
                  ListEmptyComponent={renderEmptyState}
                  ListFooterComponent={
                    showThinking ? <ThinkingIndicator /> : null
                  }
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  onContentSizeChange={handleContentSizeChange}
                  onLayout={handleListLayout}
                />

                {/* Error banner with retry */}
                {showRetry && (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>
                      {error || t('SimulationFeedback.askAIInterrupted')}
                    </Text>
                    <TouchableOpacity
                      style={styles.retryButton}
                      onPress={handleRetry}
                      activeOpacity={0.7}>
                      <Text style={styles.retryButtonText}>
                        {t('SimulationFeedback.askAIRetry')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Input */}
                <View style={styles.inputWrapper}>
                  <View
                    style={[
                      styles.inputContainer,
                      isOverLimit && styles.inputContainerError,
                    ]}>
                    <TextInput
                      style={styles.input}
                      placeholder={t('SimulationFeedback.askAIPlaceholder')}
                      placeholderTextColor={colors.ds.typography.lowEmphasis}
                      value={inputText}
                      onChangeText={setInputText}
                      multiline={false}
                      editable={!isStreaming}
                      onSubmitEditing={handleSend}
                      returnKeyType="send"
                    />
                    <TouchableOpacity
                      style={[
                        styles.sendButton,
                        canSend && styles.sendButtonActive,
                      ]}
                      onPress={handleSend}
                      activeOpacity={0.7}
                      disabled={!canSend}>
                      <UpArrowIcon
                        width={14}
                        height={14}
                        color={colors.white}
                      />
                    </TouchableOpacity>
                  </View>
                  {isOverLimit && (
                    <Text style={styles.charLimitText}>
                      {t('SimulationFeedback.askAIMaxMessages', {
                        maxMessageLength: MAX_MESSAGE_LENGTH,
                      })}
                    </Text>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </LinearGradient>
    </View>
  );
};

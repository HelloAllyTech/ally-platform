import React, {useCallback, useEffect, useRef, useState} from 'react';
import LottieView from 'lottie-react-native';
import {
  ActivityIndicator,
  FlatList,
  LayoutChangeEvent,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {animations, RankBadgeIcon, UpArrowIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {AskAiInitialState} from './AskAiInitialState';
import {styles} from './styles';
import {AskAIChatMessage, ChatMessageRole} from './types';
import {useAskAIChat} from './useAskAIChat';

// ── Props ───────────────────────────────────────────────────────

interface AskAIProps {
  scenarioSessionId?: string;
}

// ── Sub-components ──────────────────────────────────────────────

const UserMessageBubble: React.FC<{message: AskAIChatMessage}> = React.memo(
  ({message}) => (
    <View style={styles.questionBubble}>
      <Text style={styles.questionText}>{message.content}</Text>
    </View>
  ),
);

const AIMessageBubble: React.FC<{message: AskAIChatMessage}> = React.memo(
  ({message}) => (
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
      </View>
    </View>
  ),
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

  const canSend = inputText.trim().length > 0 && !isStreaming;

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
          <View style={styles.content}>
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
                  <View style={[styles.inputContainer]}>
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
                </View>
              </>
            )}
          </View>
        </View>
      </LinearGradient>
    </View>
  );
};

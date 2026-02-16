import React, {useCallback, useEffect, useRef, useState} from 'react';
import {FlatList, Text, TextInput, TouchableOpacity, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {RankBadgeIcon, UpArrowIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {AskAiInitialState} from './AskAiInitialState';
import {styles} from './styles';
import {AskAIChatMessage, ChatMessageRole} from './types';
import {useAskAIChat} from './useAskAIChat';

// ── Sub-components ─────────────────────────────────────────────

/** Renders a right-aligned user question bubble */
const UserMessageBubble: React.FC<{message: AskAIChatMessage}> = ({
  message,
}) => (
  <View style={styles.questionBubble}>
    <Text style={styles.questionText}>{message.content}</Text>
  </View>
);

/** Renders a left-aligned AI response with the rank badge icon */
const AIMessageBubble: React.FC<{message: AskAIChatMessage}> = ({message}) => (
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
);

/** Renders the "thinking" dots shown before a stream starts */
const ThinkingIndicator: React.FC = () => (
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
    <View style={styles.streamingIndicator}>
      <View style={styles.typingDot} />
      <View style={styles.typingDot} />
      <View style={styles.typingDot} />
    </View>
  </View>
);

// ── Main Component ─────────────────────────────────────────────

export const AskAI: React.FC = () => {
  const {t} = useTranslate();
  const [inputText, setInputText] = useState('');

  const {messages, isStreaming, isMaxMessagesReached, sendMessage, cleanup} =
    useAskAIChat();

  const flatListRef = useRef<FlatList<AskAIChatMessage>>(null);

  // Track whether the AI is "thinking" (user sent msg, AI hasn't started streaming yet)
  const [isThinking, setIsThinking] = useState(false);
  const prevMessageCountRef = useRef(messages.length);

  // Detect when AI message gets added (thinking -> streaming transition)
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === ChatMessageRole.AI) {
        setIsThinking(false);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  // Cleanup timers on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      // Small delay to let the FlatList render the new item
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({animated: true});
      }, 100);
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed || isStreaming || isMaxMessagesReached) {
      return;
    }
    sendMessage(trimmed);
    setInputText('');
    setIsThinking(true);
  }, [inputText, isStreaming, isMaxMessagesReached, sendMessage]);

  const canSend =
    inputText.trim().length > 0 && !isStreaming && !isMaxMessagesReached;

  const renderMessage = useCallback(({item}: {item: AskAIChatMessage}) => {
    if (item.role === ChatMessageRole.USER) {
      return <UserMessageBubble message={item} />;
    }
    return <AIMessageBubble message={item} />;
  }, []);

  const keyExtractor = useCallback((item: AskAIChatMessage) => item.id, []);

  const renderEmptyState = useCallback(
    () => <AskAiInitialState onQuestionSelection={() => {}} />,
    [],
  );

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
                isThinking && !isStreaming ? <ThinkingIndicator /> : null
              }
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() =>
                flatListRef.current?.scrollToEnd({animated: true})
              }
            />

            {/* Max messages indicator */}
            {isMaxMessagesReached && (
              <Text style={styles.maxMessagesText}>
                {t('SimulationFeedback.askAIMaxMessages')}
              </Text>
            )}

            {/* Input */}
            <View style={styles.inputWrapper}>
              <View
                style={[
                  styles.inputContainer,
                  isMaxMessagesReached && styles.inputContainerDisabled,
                ]}>
                <TextInput
                  style={styles.input}
                  placeholder={t('SimulationFeedback.askAIPlaceholder')}
                  placeholderTextColor={colors.ds.typography.lowEmphasis}
                  value={inputText}
                  onChangeText={setInputText}
                  multiline={false}
                  editable={!isStreaming && !isMaxMessagesReached}
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
                  <UpArrowIcon width={14} height={14} color={colors.white} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
};

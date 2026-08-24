import React, {useCallback, useState} from 'react';
import {Text, TextInput, TouchableOpacity, View} from 'react-native';

import {UpArrowIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {styles} from './styles';

const MAX_MESSAGE_LENGTH = 2000;

interface DebriefReplyInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

/**
 * Reply composer for the debrief thread. Same mechanics as the existing Ask
 * AI input (single-line, send-on-return), just framed as replying to Ally
 * rather than querying a tool — mirrors ally-web's DebriefReplyInput.
 */
export const DebriefReplyInput: React.FC<DebriefReplyInputProps> = ({
  onSend,
  disabled,
}) => {
  const {t} = useTranslate();
  const [inputText, setInputText] = useState('');

  const isOverLimit = inputText.length > MAX_MESSAGE_LENGTH;
  const canSend = inputText.trim().length > 0 && !disabled && !isOverLimit;

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed || disabled || isOverLimit) {
      return;
    }
    onSend(trimmed);
    setInputText('');
  }, [inputText, disabled, isOverLimit, onSend]);

  return (
    <View style={styles.inputWrapper}>
      <View
        style={[
          styles.inputContainer,
          isOverLimit && styles.inputContainerError,
        ]}>
        <TextInput
          style={styles.input}
          placeholder={t('postSim.debrief.replyPlaceholder')}
          placeholderTextColor={colors.ds.typography.lowEmphasis}
          value={inputText}
          onChangeText={setInputText}
          multiline={false}
          editable={!disabled}
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.sendButton, canSend && styles.sendButtonActive]}
          onPress={handleSend}
          activeOpacity={0.7}
          disabled={!canSend}
          testID="debrief-reply-send">
          <UpArrowIcon width={14} height={14} color={colors.white} />
        </TouchableOpacity>
      </View>
      {isOverLimit && (
        <Text style={styles.charLimitText}>
          {t('askAi.askAIMaxMessages', {
            maxMessageLength: MAX_MESSAGE_LENGTH,
          })}
        </Text>
      )}
    </View>
  );
};

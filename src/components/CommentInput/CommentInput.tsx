import {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets/icons';
import {colors, fontFamily, radius, typography} from '@/theme';

export interface CommentInputProps {
  onChangeText: (text: string) => void;
  onSend: () => void;
  comment: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  isSendButtonDisabled?: boolean;
  isLoading?: boolean;
}

export const CommentInput: React.FC<CommentInputProps> = ({
  onChangeText,
  onSend,
  comment,
  autoFocus = false,
  onFocus,
  onBlur,
  isSendButtonDisabled = false,
  isLoading = false,
}) => {
  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      setIsFocused(true);
    }
  }, [autoFocus]);

  // Listen to keyboard events to update focus state when keyboard is dismissed
  useEffect(() => {
    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setIsFocused(false);
        inputRef.current?.blur();
      },
    );

    return () => {
      keyboardWillHide.remove();
    };
  }, []);

  const onInputFocus = () => {
    setIsFocused(true);
    onFocus?.();
  };

  const onInputBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[
        styles.inputContainer,
        isFocused && styles.inputContainerFocused,
      ]}>
      <TextInput
        style={styles.input}
        value={comment}
        placeholder="Type a message..."
        onChangeText={onChangeText}
        onFocus={onInputFocus}
        onBlur={onInputBlur}
        ref={inputRef}
        autoFocus
      />
      <TouchableOpacity
        activeOpacity={isSendButtonDisabled ? 0 : 0.7}
        style={[
          styles.sendButton,
          isSendButtonDisabled && styles.sendButtonDisabled,
        ]}
        onPress={onSend}
        disabled={isSendButtonDisabled}>
        {isLoading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <LeftArrowIcon
            color={colors.white}
            width={32}
            height={32}
            style={styles.arrowIcon}
          />
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
};

const styles = ScaledSheet.create({
  inputContainerFocused: {
    backgroundColor: colors.ds.surface.background,
    paddingBottom: Platform.OS === 'ios' ? 0 : 300,
  },
  inputContainer: {
    backgroundColor: 'transparent',
    paddingHorizontal: '24@ms',
    borderWidth: 0.5,
    borderColor: colors.ds.stroke.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: colors.ds.stroke.primary,
    borderRadius: radius.full,
    paddingVertical: '8@mvs',
    paddingHorizontal: '8@ms',
    backgroundColor: colors.lightGray,
    marginRight: '8@ms',
    marginVertical: '12@mvs',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  sendButton: {
    padding: '12@mvs',
    width: '32@ms',
    height: '32@ms',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.ds.theme.primary,
  },
  sendButtonDisabled: {
    backgroundColor: colors.ds.state.disabledContent,
  },
  arrowIcon: {
    transform: [{rotate: '180deg'}],
  },
});

import React from 'react';
import {BottomSheetTextInput} from '@gorhom/bottom-sheet';
import {
  ActivityIndicator,
  Keyboard,
  TouchableOpacity,
  View,
} from 'react-native';

import {LeftArrowIcon} from '@/assets/icons';
import {colors} from '@/theme';

import {styles} from './styles';

export interface CommentBottomSheetFooterProps {
  text: string;
  setText: (text: string) => void;
  onSubmit?: (text: string) => void;
  placeholder: string;
  bottomInset: number;
  isLoading?: boolean;
}

// Memoized footer content to prevent remounting while allowing re-renders
export const CommentBottomSheetFooter =
  React.memo<CommentBottomSheetFooterProps>(
    ({text, setText, onSubmit, placeholder, isLoading = false}) => {
      return (
        <View style={styles.container}>
          <View style={styles.inputContainer}>
            <BottomSheetTextInput
              style={styles.input}
              placeholder={placeholder}
              placeholderTextColor={colors.ds.typography.mediumEmphasis}
              value={text}
              onChangeText={setText}
              multiline={false}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                !text.trim() && styles.sendButtonDisabled,
              ]}
              onPress={() => {
                if (text.trim()) {
                  onSubmit?.(text);
                  setText('');
                  Keyboard.dismiss();
                }
              }}
              disabled={!text.trim() || isLoading}
              activeOpacity={0.7}>
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
          </View>
        </View>
      );
    },
  );

CommentBottomSheetFooter.displayName = 'CommentBottomSheetFooter';

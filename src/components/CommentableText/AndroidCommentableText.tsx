import React, {useCallback} from 'react';
import {
  NativeSyntheticEvent,
  Platform,
  requireNativeComponent,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';

import {useTranslate} from '@/hooks/useTranslate';

// ─── Types ────────────────────────────────────────────────────────

export interface SelectionChangeEvent {
  messageId: string;
  start: number;
  end: number;
  selectedText: string;
}

export interface SingleTapEvent {
  messageId: string;
  /** Character offset relative to message content (prefix excluded) */
  offset: number;
}

/** Kept for backward compatibility even though thread taps are now handled in JS */
export interface ThreadPressEvent {
  messageId: string;
  threadIds: string[];
  start: number;
  end: number;
}

export interface AndroidCommentableTextProps {
  /** Which message this selection wrapper belongs to */
  messageId: string;
  /** Labels for the floating selection menu (default: ["Add comment"]) */
  menuOptions?: string[];
  /** Fired when the user selects text and taps a menu option */
  onSelectionChange?: (event: SelectionChangeEvent) => void;
  /** Fired on genuine single tap (not long-press / double-tap) with character offset */
  onSingleTap?: (event: SingleTapEvent) => void;
  /** Increment to clear native selection & dismiss the ActionMode toolbar */
  clearSelectionSignal?: number;
  /** Number of prefix characters (e.g. sender name) to exclude from selection indices */
  prefixLength?: number;
  /** React Native children – typically a <Text> with highlighted spans */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// ─── Native component (Android only) ─────────────────────────────

interface NativeProps {
  messageId: string;
  menuOptions?: string[];
  clearSelectionSignal?: number;
  prefixLength?: number;
  onSelectionChange?: (
    event: NativeSyntheticEvent<SelectionChangeEvent>,
  ) => void;
  onSingleTap?: (event: NativeSyntheticEvent<SingleTapEvent>) => void;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const NativeAndroidCommentableTextInput =
  Platform.OS === 'android'
    ? requireNativeComponent<NativeProps>('CommentableTextView')
    : null;

// ─── JS Wrapper ──────────────────────────────────────────────────

/**
 * Android-only native wrapper that enables text selection on the
 * React Native <Text> rendered as its children.
 */
export const AndroidCommentableText: React.FC<AndroidCommentableTextProps> = ({
  messageId,
  menuOptions,
  onSelectionChange,
  onSingleTap,
  clearSelectionSignal,
  prefixLength,
  children,
  style,
}) => {
  const {t} = useTranslate();
  const resolvedMenuOptions = menuOptions ?? [t('common.addComment')];
  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<SelectionChangeEvent>) => {
      onSelectionChange?.(event.nativeEvent);
    },
    [onSelectionChange],
  );

  const handleSingleTap = useCallback(
    (event: NativeSyntheticEvent<SingleTapEvent>) => {
      onSingleTap?.(event.nativeEvent);
    },
    [onSingleTap],
  );

  if (Platform.OS !== 'android' || !NativeAndroidCommentableTextInput) {
    return <View style={style}>{children}</View>;
  }

  return (
    <NativeAndroidCommentableTextInput
      messageId={messageId}
      menuOptions={resolvedMenuOptions}
      clearSelectionSignal={clearSelectionSignal}
      prefixLength={prefixLength}
      onSelectionChange={handleSelectionChange}
      onSingleTap={handleSingleTap}
      style={style}>
      {children}
    </NativeAndroidCommentableTextInput>
  );
};

export default AndroidCommentableText;

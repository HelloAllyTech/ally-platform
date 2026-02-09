import React, {useCallback} from 'react';
import {
  NativeSyntheticEvent,
  Platform,
  requireNativeComponent,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';

// ─── Types ────────────────────────────────────────────────────────

export interface SelectionChangeEvent {
  messageId: string;
  start: number;
  end: number;
  selectedText: string;
}

/** Kept for backward compatibility even though thread taps are now handled in JS */
export interface ThreadPressEvent {
  messageId: string;
  threadIds: string[];
  start: number;
  end: number;
}

export interface AndroidCommentMessageRowProps {
  /** Which message this selection wrapper belongs to */
  messageId: string;
  /** Labels for the floating selection menu (default: ["Add comment"]) */
  menuOptions?: string[];
  /** Fired when the user selects text and taps a menu option */
  onSelectionChange?: (event: SelectionChangeEvent) => void;
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
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const NativeAndroidCommentMessageRow =
  Platform.OS === 'android'
    ? requireNativeComponent<NativeProps>('AndroidCommentMessageRow')
    : null;

// ─── JS Wrapper ──────────────────────────────────────────────────

/**
 * Android-only native wrapper that enables text selection on the
 * React Native <Text> rendered as its children.
 *
 * Follows the same pattern as `@rob117/react-native-selectable-text`:
 *   - Native FrameLayout wraps the RN children
 *   - Finds the underlying ReactTextView
 *   - Calls setTextIsSelectable(true)
 *   - Shows a floating ActionMode menu on selection
 *   - Emits selection indices when a menu item is tapped
 *
 * On iOS this is a no-op passthrough (iOS has its own implementation).
 *
 * Usage:
 * ```tsx
 * <AndroidCommentMessageRow
 *   messageId={item.id}
 *   onSelectionChange={(e) => handleSelection(e)}>
 *   <Text style={styles.message}>
 *     {parts.map(p => <Text key={p.id} style={...}>{p.text}</Text>)}
 *   </Text>
 * </AndroidCommentMessageRow>
 * ```
 */
export const AndroidCommentMessageRow: React.FC<
  AndroidCommentMessageRowProps
> = ({
  messageId,
  menuOptions = ['Add comment'],
  onSelectionChange,
  clearSelectionSignal,
  prefixLength,
  children,
  style,
}) => {
  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<SelectionChangeEvent>) => {
      onSelectionChange?.(event.nativeEvent);
    },
    [onSelectionChange],
  );

  // Guard: render passthrough on iOS
  if (Platform.OS !== 'android' || !NativeAndroidCommentMessageRow) {
    return <View style={style}>{children}</View>;
  }

  return (
    <NativeAndroidCommentMessageRow
      messageId={messageId}
      menuOptions={menuOptions}
      clearSelectionSignal={clearSelectionSignal}
      prefixLength={prefixLength}
      onSelectionChange={handleSelectionChange}
      style={style}>
      {children}
    </NativeAndroidCommentMessageRow>
  );
};

export default AndroidCommentMessageRow;

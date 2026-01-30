import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  NativeSyntheticEvent,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputSelectionChangeEventData,
  TextLayoutEventData,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {isIOS} from '@/constants';
import {colors, fontFamily, typography} from '@/theme';
import type {MessagePart} from '@/types/reviews';

export interface SelectionData {
  startIndex: number;
  endIndex: number;
  selectedText: string;
  startPartIndex?: number;
  endPartIndex?: number;
  startPartOffset?: number;
  endPartOffset?: number;
}

export interface SelectableTextInputProps {
  messageId: string;
  isActive?: boolean;
  requestCloseSignal?: number;
  onRequestActivate?: (messageId: string) => void;
  value?: string;
  parts?: MessagePart[];
  separator?: string;
  prefixText?: string;
  prefixSeparator?: string;
  onAddComment?: (selection: SelectionData) => void;
  onCommentIdsPress?: (commentIds: string[], part: MessagePart) => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  partTextStyle?: StyleProp<TextStyle>;
  prefixTextStyle?: StyleProp<TextStyle>;
  highlightStyle?: StyleProp<TextStyle>;
  highlightedPartIndices?: number[];
  placeholder?: string;
  multiline?: boolean;
  onMenuVisibilityChange?: (visible: boolean) => void;
}

type Sel = {start: number; end: number};

const MENU_W = 140;
const MENU_H = 44;
const MENU_MARGIN = 8;

export const SelectableTextInput: React.FC<SelectableTextInputProps> = ({
  // new
  messageId,
  isActive = true,
  requestCloseSignal,
  onRequestActivate,

  // existing
  value,
  parts,
  separator = '',
  prefixText,
  prefixSeparator = ' ',
  onAddComment,
  onCommentIdsPress,
  style,
  textStyle,
  partTextStyle,
  prefixTextStyle,
  highlightStyle,
  highlightedPartIndices = [],
  placeholder,
  multiline = false,
  onMenuVisibilityChange,
}) => {
  const inputRef = useRef<TextInput>(null);

  const [containerW, setContainerW] = useState(0);
  const [lines, setLines] = useState<TextLayoutEventData['lines']>([]);
  const [forcedSelection, setForcedSelection] = useState<Sel | null>(null);

  const selectionRef = useRef<Sel>({start: 0, end: 0});

  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({x: 0, y: 0});
  const [selectedText, setSelectedText] = useState('');

  const mainText = useMemo(() => {
    if (parts && parts.length > 0) {
      return parts.map(part => part.text).join(separator);
    }
    return value ?? '';
  }, [parts, separator, value]);

  const prefix = useMemo(
    () => (prefixText ? `${prefixText}${prefixSeparator}` : ''),
    [prefixText, prefixSeparator],
  );

  const prefixLength = prefix.length;
  const displayText = `${prefix}${mainText}`;

  useEffect(() => {
    onMenuVisibilityChange?.(showMenu && isActive);
  }, [showMenu, isActive, onMenuVisibilityChange]);

  // Reset when text changes
  useEffect(() => {
    const s = {start: prefixLength, end: prefixLength};
    selectionRef.current = s;
    setForcedSelection(s);
    setSelectedText('');
    setShowMenu(false);

    const t = setTimeout(() => setForcedSelection(null), 0);
    return () => clearTimeout(t);
  }, [displayText, prefixLength]);

  const clearSelection = useCallback(() => {
    const s = {start: prefixLength, end: prefixLength};
    selectionRef.current = s;
    setForcedSelection(s);
    setSelectedText('');
    setShowMenu(false);
    requestAnimationFrame(() => setForcedSelection(null));
  }, [prefixLength]);

  // ✅ Close when parent requests (global dismiss)
  useEffect(() => {
    if (!requestCloseSignal) return;
    if (showMenu) clearSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestCloseSignal]); // intentionally not depending on clearSelection/showMenu to avoid re-close loops

  const contextMenuHidden = isIOS ? true : undefined;

  const computeAnchorFromLines = useCallback(
    (startIndex: number) => {
      let anchorY = 0;
      let anchorH = 20;

      if (lines.length > 0) {
        let count = 0;
        let chosen = lines[lines.length - 1]; // safer default

        for (const line of lines) {
          count += line.text.length;
          if (startIndex <= count) {
            chosen = line;
            break;
          }
        }

        anchorY = chosen.y;
        anchorH = chosen.height || 20;
      } else {
        const approxLineH = multiline ? 22 : 20;
        const lineNumber = Math.max(0, Math.floor(startIndex / 40));
        anchorY = lineNumber * approxLineH;
        anchorH = approxLineH;
      }

      let y = anchorY - MENU_H - MENU_MARGIN;
      if (y < 0) y = anchorY + anchorH + MENU_MARGIN;

      let x = Math.max(8, Math.floor(containerW / 2 - MENU_W / 2));
      if (containerW > 0) {
        x = Math.max(8, Math.min(x, containerW - MENU_W - 8));
      }

      setMenuPos({x, y});
    },
    [containerW, lines, multiline],
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const {start, end} = event.nativeEvent.selection;

      const clampedStart = Math.max(start, prefixLength);
      const clampedEnd = Math.max(end, prefixLength);

      if (clampedStart !== start || clampedEnd !== end) {
        const s = {start: clampedStart, end: clampedEnd};
        selectionRef.current = s;
        setForcedSelection(s);
        requestAnimationFrame(() => setForcedSelection(null));
        return;
      }

      const s = {start: clampedStart, end: clampedEnd};
      selectionRef.current = s;

      const hasSelection = clampedStart !== clampedEnd;
      if (!hasSelection) {
        const currentIndex = clampedStart - prefixLength;
        const selectedPart = parts?.find(
          part => currentIndex >= part.start && currentIndex <= part.end,
        );
        if (selectedPart?.commentIds?.length) {
          onCommentIdsPress?.(selectedPart.commentIds, selectedPart);
          return;
        }
        setShowMenu(false);
        setSelectedText('');
        return;
      }

      const text = displayText.substring(clampedStart, clampedEnd).trim();
      if (!text) {
        setShowMenu(false);
        setSelectedText('');
        return;
      }

      // ✅ Activate this message in parent so it becomes the only active menu
      onRequestActivate?.(messageId);

      setSelectedText(text);
      computeAnchorFromLines(clampedStart);
      setShowMenu(true);
    },
    [
      computeAnchorFromLines,
      displayText,
      messageId,
      onCommentIdsPress,
      onRequestActivate,
      parts,
      prefixLength,
    ],
  );

  const handleAddComment = useCallback(() => {
    if (!onAddComment) return;
    const s = selectionRef.current;
    const text = selectedText;
    if (!text) return;

    onAddComment({
      startIndex: s.start - prefixLength,
      endIndex: s.end - prefixLength,
      selectedText: text,
    });

    setShowMenu(false);
  }, [onAddComment, selectedText, prefixLength]);

  return (
    <View
      style={[styles.container, style]}
      onLayout={e => setContainerW(e.nativeEvent.layout.width)}>
      {/* Overlay text for visual rendering + highlighting */}
      {prefixText || (parts && parts.length > 0) ? (
        <View pointerEvents="none" style={styles.overlay}>
          <Text
            style={[styles.text, textStyle]}
            onTextLayout={e => setLines(e.nativeEvent.lines)}>
            {prefixText ? (
              <Text style={[styles.text, textStyle, prefixTextStyle]}>
                {prefix}
              </Text>
            ) : null}

            {parts && parts.length > 0
              ? parts.map((part, index) => {
                  const isHighlighted = highlightedPartIndices.includes(index);
                  const suffix = index < parts.length - 1 ? separator : '';
                  return (
                    <Text
                      key={`${index}-${part.text}`}
                      style={[
                        styles.text,
                        textStyle,
                        partTextStyle,
                        isHighlighted && styles.highlightedText,
                        isHighlighted && highlightStyle,
                      ]}
                      suppressHighlighting>
                      {part.text}
                      {suffix}
                    </Text>
                  );
                })
              : mainText}
          </Text>
        </View>
      ) : null}

      {/* Invisible input for selection */}
      <TextInput
        ref={inputRef}
        value={displayText}
        editable
        showSoftInputOnFocus={false}
        selectTextOnFocus={false}
        onSelectionChange={handleSelectionChange}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        placeholder={placeholder}
        placeholderTextColor={colors.ds.typography.lowEmphasis}
        selectionColor="rgba(173, 216, 230, 0.5)"
        selection={forcedSelection ?? undefined}
        // @ts-ignore
        contextMenuHidden={contextMenuHidden}
        // @ts-ignore
        importantForAutofill="no"
        caretHidden
        style={[
          styles.textInput,
          textStyle,
          (prefixText || (parts && parts.length > 0)) && styles.transparentText,
        ]}
      />

      {/* ✅ Tooltip only (no full overlay). Outside dismiss is handled by Conversation overlay */}
      {showMenu && isActive ? (
        <View
          style={[
            styles.menuContainer,
            {
              top: menuPos.y,
              left: menuPos.x,
              width: MENU_W,
              height: MENU_H,
            },
          ]}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={handleAddComment}
            activeOpacity={0.7}>
            <Text style={styles.menuItemText}>Add comment</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start',
    zIndex: 1,
  },
  text: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  textInput: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    padding: 0,
    margin: 0,
    zIndex: 0,
  },
  transparentText: {
    color: 'transparent',
  },
  highlightedText: {
    backgroundColor: colors.ds.theme.primary,
  },
  menuContainer: {
    position: 'absolute',
    backgroundColor: colors.ds.surface.background,
    borderRadius: 8,
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 8,
    zIndex: 9999,
  },
  menuItem: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  menuItemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
});

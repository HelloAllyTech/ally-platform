import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Dimensions,
  Modal,
  NativeSyntheticEvent,
  processColor,
  requireNativeComponent,
  StyleProp,
  StyleSheet,
  Text,
  TextLayoutEventData,
  TextStyle,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

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

export interface CommentableTextInputProps {
  messageId: string;
  isActive?: boolean;
  requestCloseSignal?: number;
  onRequestActivate?: (messageId: string) => void;
  onRequestClose?: () => void;
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
}

type Sel = {start: number; end: number};

type NativeCommentRange = {
  start: number;
  end: number;
  commentIds: string[];
  highlighted?: boolean;
};

type NativeSelectionEvent = {
  start: number;
  end: number;
  selectionRect?: {x: number; y: number; width: number; height: number};
};

type NativeCommentPressEvent = {
  commentIds: string[];
  start: number;
  end: number;
};

type NativeProps = {
  text: string;
  commentRanges: NativeCommentRange[];
  prefixLength: number;
  selection?: Sel;
  selectableEnabled?: boolean;
  multiline?: boolean;
  textStyle?: Record<string, unknown>;
  partTextStyle?: Record<string, unknown>;
  prefixTextStyle?: Record<string, unknown>;
  highlightStyle?: Record<string, unknown>;
  onSelectionChange?: (
    event: NativeSyntheticEvent<NativeSelectionEvent>,
  ) => void;
  onCommentPress?: (
    event: NativeSyntheticEvent<NativeCommentPressEvent>,
  ) => void;
  style?: StyleProp<ViewStyle>;
};

const NativeCommentableTextView = requireNativeComponent<NativeProps>(
  'CommentableTextView',
);

const MENU_W = 140;
const MENU_H = 44;
const MENU_MARGIN = 8;

const normalizeTextStyle = (style?: StyleProp<TextStyle>) => {
  const flat = StyleSheet.flatten(style) ?? {};
  const color = flat.color ? processColor(flat.color) : undefined;
  const backgroundColor = flat.backgroundColor
    ? processColor(flat.backgroundColor)
    : undefined;
  const borderBottomColor = flat.borderBottomColor
    ? processColor(flat.borderBottomColor)
    : undefined;
  return {
    ...flat,
    color: color ?? undefined,
    backgroundColor: backgroundColor ?? undefined,
    borderBottomColor: borderBottomColor ?? undefined,
  };
};

export const CommentableTextInput: React.FC<CommentableTextInputProps> = ({
  messageId,
  isActive = true,
  requestCloseSignal,
  onRequestActivate,
  onRequestClose,
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
}) => {
  const containerRef = useRef<View>(null);
  const selectionRef = useRef<Sel>({start: 0, end: 0});
  const ignoreNextSelectionEvent = useRef(false);
  const forcedSelectionRef = useRef<Sel | null>(null);

  const [forcedSelection, setForcedSelection] = useState<Sel | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [menuAbsPos, setMenuAbsPos] = useState({x: 0, y: 0});
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  const mainText = useMemo(() => {
    if (parts && parts.length > 0)
      return parts.map(p => p.text).join(separator);
    return value ?? '';
  }, [parts, separator, value]);

  const prefix = useMemo(
    () => (prefixText ? `${prefixText}${prefixSeparator}` : ''),
    [prefixText, prefixSeparator],
  );

  const prefixLength = prefix.length;
  const displayText = `${prefix}${mainText}`;

  const computedParts = useMemo(() => {
    if (!parts || parts.length === 0) return [];
    const result: Array<{
      part: MessagePart;
      start: number;
      end: number;
      index: number;
    }> = [];
    let offset = 0;
    parts.forEach((part, index) => {
      const start = offset;
      const end = start + part.text.length;
      result.push({part, start, end, index});
      offset = end + (index < parts.length - 1 ? separator.length : 0);
    });
    return result;
  }, [parts, separator]);

  const commentRanges = useMemo<NativeCommentRange[]>(() => {
    if (computedParts.length === 0) return [];
    return computedParts
      .filter(({part}) => part.commentIds?.length)
      .map(({part, start, end, index}) => ({
        start: start + prefixLength,
        end: end + prefixLength,
        commentIds: part.commentIds,
        highlighted: highlightedPartIndices.includes(index),
      }));
  }, [computedParts, highlightedPartIndices, prefixLength]);

  const findWordRange = useCallback((text: string, index: number) => {
    if (!text.length) return null;
    const isWordChar = (ch: string) => /[A-Za-z0-9]/.test(ch);
    let i = Math.min(Math.max(index, 0), text.length - 1);
    if (!isWordChar(text[i])) {
      let left = i - 1;
      let right = i + 1;
      while (left >= 0 || right < text.length) {
        if (left >= 0 && isWordChar(text[left])) {
          i = left;
          break;
        }
        if (right < text.length && isWordChar(text[right])) {
          i = right;
          break;
        }
        left -= 1;
        right += 1;
      }
      if (!isWordChar(text[i])) return null;
    }
    let start = i;
    let end = i + 1;
    while (start > 0 && isWordChar(text[start - 1])) start -= 1;
    while (end < text.length && isWordChar(text[end])) end += 1;
    if (start === end) return null;
    return {start, end};
  }, []);

  const handleTextLayout = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      const lines = event.nativeEvent.lines;
      if (!lines?.length) return;
      const lastLine = lines[lines.length - 1];
      const nextHeight = Math.ceil(lastLine.y + lastLine.height);
      if (nextHeight !== measuredHeight) {
        setMeasuredHeight(nextHeight);
      }
    },
    [measuredHeight],
  );

  // Reset on text change
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
    ignoreNextSelectionEvent.current = true;
    setForcedSelection(s);
    setSelectedText('');
    setShowMenu(false);
    requestAnimationFrame(() => setForcedSelection(null));
  }, [prefixLength]);

  // Close when parent requests
  useEffect(() => {
    if (requestCloseSignal === undefined) return;
    if (showMenu) {
      clearSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestCloseSignal]);

  const positionMenuFromRect = useCallback(
    (rect?: NativeSelectionEvent['selectionRect']) => {
      if (!rect) return false;

      const screen = Dimensions.get('window');
      const anchorX = rect.x + rect.width / 2;
      const anchorY = rect.y;
      const anchorH = rect.height || 20;

      let y = anchorY - MENU_H - MENU_MARGIN;
      if (y < 0) y = anchorY + anchorH + MENU_MARGIN;

      let x = anchorX - MENU_W / 2;
      x = Math.max(8, Math.min(x, screen.width - MENU_W - 8));

      setMenuAbsPos({x, y});
      return true;
    },
    [],
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<NativeSelectionEvent>) => {
      if (ignoreNextSelectionEvent.current) {
        const {start: evtStart, end: evtEnd} = event.nativeEvent;
        const forced = forcedSelectionRef.current;
        ignoreNextSelectionEvent.current = false;
        forcedSelectionRef.current = null;
        if (forced && evtStart === forced.start && evtEnd === forced.end) {
          return;
        }
      }

      const {start, end, selectionRect} = event.nativeEvent;
      const clampedStart = Math.max(start, prefixLength);
      const clampedEnd = Math.max(end, prefixLength);

      if (clampedStart !== start || clampedEnd !== end) {
        const s = {start: clampedStart, end: clampedEnd};
        selectionRef.current = s;
        ignoreNextSelectionEvent.current = true;
        forcedSelectionRef.current = s;
        setForcedSelection(s);
        requestAnimationFrame(() => setForcedSelection(null));
        if (clampedStart === clampedEnd) {
          setShowMenu(false);
          setSelectedText('');
          return;
        }
      }

      const s = {start: clampedStart, end: clampedEnd};
      selectionRef.current = s;

      const hasSelection = clampedStart !== clampedEnd;
      if (!hasSelection) {
        const wordRange = findWordRange(displayText, clampedStart);
        if (wordRange && wordRange.end > prefixLength) {
          const nextStart = Math.max(wordRange.start, prefixLength);
          const nextEnd = Math.max(wordRange.end, nextStart);
          if (nextEnd > nextStart) {
            const nextSelection = {start: nextStart, end: nextEnd};
            ignoreNextSelectionEvent.current = true;
            forcedSelectionRef.current = nextSelection;
            selectionRef.current = nextSelection;
            setForcedSelection(nextSelection);
            requestAnimationFrame(() => setForcedSelection(null));
            const wordText = displayText.substring(nextStart, nextEnd);
            onRequestActivate?.(messageId);
            setSelectedText(wordText);
            if (!positionMenuFromRect(selectionRect)) {
              containerRef.current?.measureInWindow((x, y, w) => {
                setMenuAbsPos({
                  x: x + Math.max(8, Math.floor(w / 2 - MENU_W / 2)),
                  y: y + MENU_MARGIN,
                });
              });
            }
            setShowMenu(true);
            return;
          }
        }
        setShowMenu(false);
        setSelectedText('');
        return;
      }

      const text = displayText.substring(clampedStart, clampedEnd);
      if (!text) {
        setShowMenu(false);
        setSelectedText('');
        return;
      }

      onRequestActivate?.(messageId);
      setSelectedText(text);
      if (!positionMenuFromRect(selectionRect)) {
        containerRef.current?.measureInWindow((x, y, w) => {
          setMenuAbsPos({
            x: x + Math.max(8, Math.floor(w / 2 - MENU_W / 2)),
            y: y + MENU_MARGIN,
          });
        });
      }
      setShowMenu(true);
    },
    [
      displayText,
      findWordRange,
      messageId,
      onRequestActivate,
      positionMenuFromRect,
      prefixLength,
    ],
  );

  const handleCommentPress = useCallback(
    (event: NativeSyntheticEvent<NativeCommentPressEvent>) => {
      const {commentIds, start, end} = event.nativeEvent;
      const rangeStart = Math.max(0, start - prefixLength);
      const rangeEnd = Math.max(0, end - prefixLength);
      const matched = computedParts.find(
        ({start: s, end: e}) =>
          rangeStart >= s && rangeStart < e && rangeEnd <= e,
      );

      const targetPart = matched?.part ?? parts?.[0];
      if (commentIds?.length && targetPart) {
        onCommentIdsPress?.(commentIds, targetPart);
      }

      clearSelection();
      onRequestClose?.();
    },
    [
      clearSelection,
      computedParts,
      onCommentIdsPress,
      onRequestClose,
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

    clearSelection();
    onRequestClose?.();
  }, [
    clearSelection,
    onAddComment,
    onRequestClose,
    prefixLength,
    selectedText,
  ]);

  const handleDismissMenu = useCallback(() => {
    clearSelection();
    onRequestClose?.();
  }, [clearSelection, onRequestClose]);

  const shouldShowModal = showMenu && isActive;

  return (
    <View ref={containerRef} style={[styles.container, style]}>
      {displayText.length === 0 && placeholder ? (
        <Text style={[styles.placeholder, textStyle]}>{placeholder}</Text>
      ) : null}

      <View pointerEvents="none" style={styles.measureOverlay}>
        <Text
          style={[styles.measureText, textStyle]}
          onTextLayout={handleTextLayout}>
          {prefixText ? (
            <Text style={[styles.measureText, textStyle, prefixTextStyle]}>
              {prefix}
            </Text>
          ) : null}
          {parts && parts.length > 0
            ? parts.map((part, index) => {
                const suffix = index < parts.length - 1 ? separator : '';
                return (
                  <Text
                    key={`measure-${index}-${part.text}`}
                    style={[styles.measureText, textStyle, partTextStyle]}>
                    {part.text}
                    {suffix}
                  </Text>
                );
              })
            : mainText}
        </Text>
      </View>

      <NativeCommentableTextView
        text={displayText}
        selectableEnabled
        multiline={multiline}
        prefixLength={prefixLength}
        commentRanges={commentRanges}
        selection={forcedSelection ?? undefined}
        textStyle={normalizeTextStyle(textStyle)}
        partTextStyle={normalizeTextStyle(partTextStyle)}
        prefixTextStyle={normalizeTextStyle(prefixTextStyle)}
        highlightStyle={normalizeTextStyle(highlightStyle)}
        style={[
          styles.nativeText,
          measuredHeight ? {height: measuredHeight} : null,
        ]}
        onSelectionChange={handleSelectionChange}
        onCommentPress={handleCommentPress}
      />

      <Modal
        visible={shouldShowModal}
        transparent
        animationType="fade"
        onRequestClose={handleDismissMenu}>
        <TouchableWithoutFeedback onPress={handleDismissMenu}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.menuContainer,
                  {
                    top: menuAbsPos.y,
                    left: menuAbsPos.x,
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
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'relative',
    flex: 1,
    alignSelf: 'stretch',
  },
  nativeText: {
    minHeight: '20@ms',
    flex: 1,
    alignSelf: 'stretch',
    width: '100%',
  },
  measureOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
    zIndex: -1,
  },
  measureText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
  },
  placeholder: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.lowEmphasis,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
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
    elevation: 20,
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

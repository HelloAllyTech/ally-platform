import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Modal,
  NativeSyntheticEvent,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputSelectionChangeEventData,
  TextLayoutEventData,
  TextStyle,
  TouchableOpacity,
  TouchableWithoutFeedback,
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

const MENU_W = 140;
const MENU_H = 44;
const MENU_MARGIN = 8;

export const SelectableTextInput: React.FC<SelectableTextInputProps> = ({
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
  const inputRef = useRef<TextInput>(null);
  const containerRef = useRef<View>(null);

  const [containerW, setContainerW] = useState(0);
  const [lines, setLines] = useState<TextLayoutEventData['lines']>([]);
  const [forcedSelection, setForcedSelection] = useState<Sel | null>(null);
  const selectionRef = useRef<Sel>({start: 0, end: 0});

  const [showMenu, setShowMenu] = useState(false);
  const [selectedText, setSelectedText] = useState('');

  // menu position in SCREEN coordinates (for Modal)
  const [menuAbsPos, setMenuAbsPos] = useState({x: 0, y: 0});

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

  const contextMenuHidden = isIOS ? true : undefined;

  const clearSelection = useCallback(() => {
    const s = {start: prefixLength, end: prefixLength};
    selectionRef.current = s;
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

  const computeMenuAbsPosition = useCallback(
    (startIndex: number) => {
      // First compute Y within the text block using lines
      let anchorY = 0;
      let anchorH = 20;

      if (lines.length > 0) {
        let count = 0;
        let chosen = lines[lines.length - 1];

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

      // menu position relative to container
      let relY = anchorY - MENU_H - MENU_MARGIN;
      if (relY < 0) relY = anchorY + anchorH + MENU_MARGIN;

      let relX = Math.max(8, Math.floor(containerW / 2 - MENU_W / 2));
      if (containerW > 0) {
        relX = Math.max(8, Math.min(relX, containerW - MENU_W - 8));
      }

      // Convert to screen coords
      containerRef.current?.measureInWindow((x, y) => {
        setMenuAbsPos({
          x: x + relX,
          y: y + relY,
        });
      });
    },
    [containerW, lines, multiline],
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const {start, end} = event.nativeEvent.selection;

      // clamp prefix
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

      // collapsed selection: maybe tap on a commented part
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

      // make this row active
      onRequestActivate?.(messageId);

      setSelectedText(text);
      computeMenuAbsPosition(clampedStart);
      setShowMenu(true);
    },
    [
      computeMenuAbsPosition,
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

    // close menu (keep selection if you want, but you said close)
    clearSelection();
    onRequestClose?.();
  }, [
    onAddComment,
    selectedText,
    prefixLength,
    clearSelection,
    onRequestClose,
  ]);

  const handleDismissMenu = useCallback(() => {
    clearSelection();
    onRequestClose?.();
  }, [clearSelection, onRequestClose]);

  const shouldShowModal = showMenu && isActive;

  return (
    <View
      ref={containerRef}
      style={[styles.container, style]}
      onLayout={e => setContainerW(e.nativeEvent.layout.width)}>
      {/* Overlay (highlight rendering) */}
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

      {/* Tooltip rendered in a transparent Modal so it is ALWAYS clickable */}
      <Modal
        visible={shouldShowModal}
        transparent
        animationType="fade"
        onRequestClose={handleDismissMenu}>
        {/* Backdrop: tap anywhere outside menu closes */}
        <TouchableWithoutFeedback onPress={handleDismissMenu}>
          <View style={styles.modalOverlay}>
            {/* Stop propagation inside menu */}
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

  // Modal overlay catches outside taps
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

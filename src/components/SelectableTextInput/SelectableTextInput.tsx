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
  TouchableWithoutFeedback,
  View,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {isIOS} from '@/constants';
import {colors, fontFamily, typography} from '@/theme';

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
  value?: string;
  parts?: string[];
  separator?: string;
  prefixText?: string;
  prefixSeparator?: string;
  onAddComment?: (selection: SelectionData) => void;
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
  value,
  parts,
  separator = '',
  prefixText,
  prefixSeparator = ' ',
  onAddComment,
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

  // Container measurement (relative positioning basis)
  const [containerW, setContainerW] = useState(0);

  // Accurate line data from overlay text
  const [lines, setLines] = useState<TextLayoutEventData['lines']>([]);

  // selection forcing only when needed (clamp/reset), otherwise let native manage
  const [forcedSelection, setForcedSelection] = useState<Sel | null>(null);
  const selectionRef = useRef<Sel>({start: 0, end: 0});

  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({x: 0, y: 0});
  const [selectedText, setSelectedText] = useState('');

  const mainText = useMemo(() => {
    if (parts && parts.length > 0) return parts.join(separator);
    return value ?? '';
  }, [parts, separator, value]);

  const prefix = useMemo(
    () => (prefixText ? `${prefixText}${prefixSeparator}` : ''),
    [prefixText, prefixSeparator],
  );

  const prefixLength = prefix.length;
  const displayText = `${prefix}${mainText}`;

  useEffect(() => {
    onMenuVisibilityChange?.(showMenu);
  }, [showMenu, onMenuVisibilityChange]);

  // Keep selection baseline at prefix start when text changes
  useEffect(() => {
    const s = {start: prefixLength, end: prefixLength};
    selectionRef.current = s;
    setForcedSelection(s);
    setSelectedText('');
    setShowMenu(false);

    // release forcing next tick so user can select smoothly
    const t = setTimeout(() => setForcedSelection(null), 0);
    return () => clearTimeout(t);
  }, [displayText, prefixLength]);

  // Hide native menu on iOS
  // NOTE: Android cannot reliably hide the OS selection menu without native code.
  // This still keeps selection functionality.
  const contextMenuHidden = isIOS ? true : undefined;

  const computeAnchorFromLines = useCallback(
    (startIndex: number) => {
      // Default anchor near top if we can't compute
      let anchorY = 0;
      let anchorH = 20;

      if (lines.length > 0) {
        // Map selection start to the correct line by accumulating line text lengths.
        // NOTE: line.text is what RN lays out; this is still an approximation for index mapping
        // but far better than charsPerLine and works well visually.
        let count = 0;
        let chosen = lines[0];

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
        // fallback: approximate by line height only
        const approxLineH = multiline ? 22 : 20;
        const lineNumber = Math.max(0, Math.floor(startIndex / 40));
        anchorY = lineNumber * approxLineH;
        anchorH = approxLineH;
      }

      // Position menu above the line (or below if not enough space)
      let y = anchorY - MENU_H - MENU_MARGIN;
      if (y < 0) y = anchorY + anchorH + MENU_MARGIN;

      // Center horizontally within container
      let x = Math.max(8, Math.floor(containerW / 2 - MENU_W / 2));
      if (containerW > 0) {
        x = Math.max(8, Math.min(x, containerW - MENU_W - 8));
      }

      setMenuPos({x, y});
    },
    [containerW, lines, multiline],
  );

  const clearSelection = useCallback(() => {
    const s = {start: prefixLength, end: prefixLength};
    selectionRef.current = s;
    setForcedSelection(s);
    setSelectedText('');
    setShowMenu(false);

    // clear forcing quickly so selection feels native
    requestAnimationFrame(() => setForcedSelection(null));
  }, [prefixLength]);

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const {start, end} = event.nativeEvent.selection;

      // clamp so prefix can't be selected
      const clampedStart = Math.max(start, prefixLength);
      const clampedEnd = Math.max(end, prefixLength);

      // If clamp was needed, force selection once and return
      if (clampedStart !== start || clampedEnd !== end) {
        const s = {start: clampedStart, end: clampedEnd};
        selectionRef.current = s;
        setForcedSelection(s);
        // release forcing next frame
        requestAnimationFrame(() => setForcedSelection(null));
        return;
      }

      const s = {start: clampedStart, end: clampedEnd};
      selectionRef.current = s;

      const hasSelection = clampedStart !== clampedEnd;
      if (!hasSelection) {
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

      setSelectedText(text);
      computeAnchorFromLines(clampedStart);
      setShowMenu(true);
    },
    [computeAnchorFromLines, displayText, prefixLength],
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

    // hide menu but keep selection
    setShowMenu(false);
  }, [onAddComment, selectedText, prefixLength]);

  const handleDismissMenu = useCallback(() => {
    // hide menu and clear selection (or you can choose to keep selection)
    clearSelection();
  }, [clearSelection]);

  return (
    <View
      style={[styles.container, style]}
      onLayout={e => setContainerW(e.nativeEvent.layout.width)}>
      {/* Overlay text for visual rendering + highlighting (pointerEvents none so input gets selection) */}
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
                      key={`${index}-${part}`}
                      style={[
                        styles.text,
                        textStyle,
                        partTextStyle,
                        isHighlighted && styles.highlightedText,
                        isHighlighted && highlightStyle,
                      ]}>
                      {part}
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
        // Force selection only when needed
        selection={forcedSelection ?? undefined}
        // Hide iOS native menu
        // @ts-ignore
        contextMenuHidden={contextMenuHidden}
        // @ts-ignore
        importantForAutofill="no"
        // Hide caret/cursor visuals (selection handles may still appear on Android)
        caretHidden
        style={[
          styles.textInput,
          textStyle,
          (prefixText || (parts && parts.length > 0)) && styles.transparentText,
        ]}
      />

      {/* Custom menu anchored INSIDE this row container */}
      {showMenu ? (
        <TouchableWithoutFeedback onPress={handleDismissMenu}>
          <View style={StyleSheet.absoluteFill}>
            <TouchableWithoutFeedback>
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
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
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
    // IMPORTANT: use flex-start so line y matches input rendering
    justifyContent: 'flex-start',
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

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Modal,
  NativeSyntheticEvent,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputSelectionChangeEventData,
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
}

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
}) => {
  const inputRef = useRef<TextInput>(null);
  const [selection, setSelection] = useState({start: 0, end: 0});
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({x: 0, y: 0});
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

  // Hide default context menu on iOS
  useEffect(() => {
    if (isIOS && inputRef.current) {
      // @ts-ignore - contextMenuHidden is not in types but works on iOS
      inputRef.current.setNativeProps({contextMenuHidden: true});
    }
  }, []);

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const {start, end} = event.nativeEvent.selection;
      const clampedStart = Math.max(start, prefixLength);
      const clampedEnd = Math.max(end, prefixLength);
      const hasSelection = clampedStart !== clampedEnd;
      if (clampedStart !== start || clampedEnd !== end) {
        setSelection({start: clampedStart, end: clampedEnd});
        return;
      }

      setSelection({start: clampedStart, end: clampedEnd});

      if (hasSelection && displayText) {
        const text = displayText.substring(clampedStart, clampedEnd).trim();
        if (text.length > 0) {
          setSelectedText(text);

          // Get input position to show menu
          if (inputRef.current) {
            inputRef.current.measureInWindow((x, y, width, height) => {
              // Calculate approximate position based on selection
              // For multiline text, estimate line position
              const lineHeight = multiline ? 24 : 20; // Approximate line height
              const charsPerLine = Math.max(1, Math.floor(width / 10)); // Approximate chars per line
              const lineNumber = Math.floor(clampedStart / charsPerLine);
              const menuY =
                y + Math.min(lineNumber * lineHeight, height - 60) - 50; // Position above selection

              setMenuPosition({
                x: Math.max(10, Math.min(x + width / 2 - 60, x + width - 130)), // Center the menu, but keep it within bounds
                y: Math.max(50, menuY), // Ensure menu is visible
              });
              setShowMenu(true);
            });
          }
        } else {
          setShowMenu(false);
        }
      } else {
        setShowMenu(false);
        setSelectedText('');
      }
    },
    [displayText, multiline, prefixLength],
  );

  const handleAddComment = useCallback(() => {
    if (onAddComment && selectedText) {
      onAddComment({
        startIndex: selection.start,
        endIndex: selection.end,
        selectedText: selectedText,
      });
    }
    // Hide menu but keep selection visible
    setShowMenu(false);
  }, [onAddComment, selectedText, selection]);

  const handleDismissMenu = useCallback(() => {
    setShowMenu(false);
    // Clear selection when menu is dismiss,ed
    if (inputRef.current) {
      inputRef.current.setNativeProps({selection: {start: 0, end: 0}});
    }
  }, []);

  return (
    <View style={[styles.container, style]}>
      {prefixText || (parts && parts.length > 0) ? (
        <View pointerEvents="none" style={styles.overlay}>
          <Text style={[styles.text, textStyle]}>
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
      <TextInput
        ref={inputRef}
        value={displayText}
        editable
        selectTextOnFocus={false}
        selectionColor="rgba(173, 216, 230, 0.5)"
        onSelectionChange={handleSelectionChange}
        showSoftInputOnFocus={false}
        style={[
          styles.textInput,
          textStyle,
          (prefixText || (parts && parts.length > 0)) && styles.transparentText,
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.ds.typography.lowEmphasis}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        selection={selection}
        // @ts-ignore - contextMenuHidden works on iOS to hide default menu
        contextMenuHidden={isIOS ? true : undefined}
        // @ts-ignore - importantForAutofill to prevent Android menu
        importantForAutofill="no"
        // Prevent text selection handles from showing default menu
        caretHidden={false}
        cursorColor="transparent"
        selectionHandleColor="transparent"
      />

      <Modal
        visible={showMenu}
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
                    top: menuPosition.y,
                    left: menuPosition.x,
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
    justifyContent: 'center',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  menuContainer: {
    position: 'absolute',
    backgroundColor: colors.ds.surface.background,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    minWidth: 120,
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1000,
  },
  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  menuItemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
});

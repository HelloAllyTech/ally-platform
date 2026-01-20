import type {FC, ReactNode} from 'react';
import {SelectableTextView} from '@rob117/react-native-selectable-text';
import {StyleSheet, View, ViewStyle} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {TextSelection} from '@/types/reviews';

// SelectionEvent type matching the patched library implementation
// The library's .d.ts files are out of sync, so we define it manually
export interface SelectionEvent {
  chosenOption: string;
  highlightedText: string;
  startIndex: number;
  endIndex: number;
}

// Type for the library's incomplete SelectionEvent (from .d.ts)
type LibrarySelectionEvent = {
  chosenOption: string;
  highlightedText: string;
};

export interface SelectableTextAreaProps {
  children: ReactNode;
  onSelection?: (selection: TextSelection) => void;
  menuOptions?: string[];
  containerStyle?: ViewStyle;
}

export const SelectableTextArea: FC<SelectableTextAreaProps> = ({
  onSelection,
  menuOptions = ['Copy'],
  containerStyle,
  children,
}) => {
  const handleSelection = (evt: SelectionEvent) => {
    const {highlightedText, startIndex, endIndex} = evt;
    onSelection?.({selectedText: highlightedText, startIndex, endIndex});
  };

  return (
    <View style={[containerStyle]}>
      <SelectableTextView
        menuOptions={menuOptions}
        onSelection={handleSelection as (event: LibrarySelectionEvent) => void}
        style={StyleSheet.flatten(styles.selectableView)}>
        {children}
      </SelectableTextView>
    </View>
  );
};

const styles = ScaledSheet.create({
  selectableView: {
    flex: 1,
  },
});

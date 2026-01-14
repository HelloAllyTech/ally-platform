import {SelectableTextView} from '@rob117/react-native-selectable-text';
import {StyleSheet, View, ViewStyle} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

export interface SelectionEvent {
  chosenOption: string;
  highlightedText: string;
}

export interface SelectableTextAreaProps {
  /**
   * The text content to display in the selectable text area
   */
  children: React.ReactNode;
  /**
   * Callback fired when text selection is made
   */
  onSelection?: (selectedText: string) => void;
  /**
   * Menu options to show in the context menu when text is selected
   * @default ['Copy']
   */
  menuOptions?: string[];
  /**
   * Custom style for the container
   */
  containerStyle?: ViewStyle;
}

export const SelectableTextArea: React.FC<SelectableTextAreaProps> = ({
  onSelection,
  menuOptions = ['Copy'],
  containerStyle,
  children,
}) => {
  const handleSelection = (evt: SelectionEvent) => {
    const {highlightedText} = evt;
    onSelection?.(highlightedText);
  };

  return (
    <View style={[containerStyle]}>
      <SelectableTextView
        menuOptions={menuOptions}
        onSelection={handleSelection}
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

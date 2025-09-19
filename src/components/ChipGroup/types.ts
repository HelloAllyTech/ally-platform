import {StyleProp, TextStyle, ViewStyle} from 'react-native';

import {IssueOptions} from '@/constants';
import {TranslationType} from '@/localization/locales/type';

export interface ChipOption {
  label: TranslationType;
  value: IssueOptions;
}

export interface ChipGroupProps {
  options: ChipOption[];
  selectedValues: string[];
  onSelectionChange: (selectedValues: string[]) => void;
  title?: string;
  customContainerStyle?: StyleProp<ViewStyle>;
  customChipStyle?: StyleProp<ViewStyle>;
  customChipTextStyle?: StyleProp<TextStyle>;
  customTitleStyle?: StyleProp<TextStyle>;
  testID?: string;
}

export interface ChipProps {
  option: ChipOption;
  isSelected: boolean;
  onPress: () => void;
  customStyle?: StyleProp<ViewStyle>;
  customTextStyle?: StyleProp<TextStyle>;
  testID?: string;
}

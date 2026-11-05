export interface DropdownMenuItem {
  icon: React.ReactNode;
  text: string;
  isSelected?: boolean;
  selectedIcon?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}

export interface DropdownMenuProps {
  visible: boolean;
  onClose: () => void;
  items: DropdownMenuItem[];
  containerOffsetTop?: number;
  containerOffsetX?: number;
  width?: number;
  testID?: string;
}

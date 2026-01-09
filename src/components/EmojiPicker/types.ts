export interface EmojiPickerProps {
  /** Array of currently selected emoji Unicode values (e.g., '1F44D' for 👍) */
  selectedEmojis?: string[];
  /** Callback when an emoji is selected or deselected. Receives Unicode value (e.g., '1F44D') */
  onEmojiSelect: (unicode: string, isSelected: boolean) => void;
  /** Horizontal offset for positioning the emoji list */
  containerOffsetX?: number;
  /** Custom icon component (defaults to add_reaction.svg) */
  icon?: React.ReactNode;
  /** Size of emoji buttons */
  emojiSize?: number;
  /** Test ID for testing */
  testID?: string;
}

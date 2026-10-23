export interface EmojiPickerProps {
  /** Array of currently selected emoji Unicode values (e.g., '1F44D' for 👍) */
  selectedEmoji?: string | null;
  /** Callback when an emoji is selected or deselected. Receives Unicode value (e.g., '1F44D') */
  onEmojiSelect: (currentEmoji: string | null, unicode: string) => void;
  /** Horizontal offset for positioning the emoji list */
  containerOffsetX?: number;
  /** Custom icon component (defaults to add_reaction.svg) */
  icon?: React.ReactNode;
  /** Size of emoji buttons */
  emojiSize?: number;
  /** Test ID for testing */
  testID?: string;
  /** Whether to disable the emoji picker */
  disabled?: boolean;
  /** Whether to show an error message */
  error?: string;
}

import {ReactNode} from 'react';
import {BottomSheetModalMethods} from '@gorhom/bottom-sheet/lib/typescript/types';

export interface BottomSheetProps {
  /**
   * Whether the bottom sheet is visible
   */
  visible: boolean;

  /**
   * Callback when the bottom sheet is closed
   */
  onClose: () => void;

  /**
   * Content to render inside the bottom sheet
   */
  children: ReactNode;

  /**
   * Initial snap point as a percentage (0-100) or string
   * Examples: 25, '25%', 300
   * Default: 50
   */
  initialSnapPoint?: number | string;

  /**
   * Whether to allow dragging to expand to almost full screen (90%)
   * Default: true
   */
  allowFullExpand?: boolean;

  /**
   * Custom snap points array
   * If provided, this overrides initialSnapPoint and allowFullExpand
   * Examples: ['25%', '50%', '90%'] or [300, 500, 800]
   */
  snapPoints?: (string | number)[];

  /**
   * Whether to show the backdrop overlay
   * Default: true
   */
  showBackdrop?: boolean;

  /**
   * Callback when backdrop is pressed
   */
  onBackdropPress?: () => void;

  /**
   * Whether to enable pan down to close gesture
   * Default: true
   */
  enablePanDownToClose?: boolean;

  /**
   * Background color of the bottom sheet
   * Default: white
   */
  backgroundColor?: string;

  /**
   * Whether to show the handle indicator at the top
   * Default: true
   */
  showHandle?: boolean;

  /**
   * Index of the snap point to start at
   * -1 means closed, 0 means first snap point
   * Default: 0
   */
  index?: number;

  /**
   * Animation duration in milliseconds
   * Default: 300
   */
  animationDuration?: number;
}

export interface BottomSheetRef extends BottomSheetModalMethods {}

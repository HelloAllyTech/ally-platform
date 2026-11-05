import {ReactNode} from 'react';
import {BottomSheetFooterProps} from '@gorhom/bottom-sheet';
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

  /**
   * Skip wrapping children in BottomSheetView
   * Useful when using BottomSheetFlatList or BottomSheetScrollView directly
   * Default: false
   */
  skipBottomSheetView?: boolean;

  /**
   * Enable content panning gesture (scrolling within the sheet)
   * When false, only the handle can be used to drag the sheet
   * Default: true
   */
  enableContentPanningGesture?: boolean;

  /**
   * Enable dynamic sizing of the bottom sheet
   * When false, sheet size is fixed to snap points
   * Default: true
   */
  enableDynamicSizing?: boolean;

  /**
   * Enable over-drag beyond snap points
   * Default: true
   */
  enableOverDrag?: boolean;

  /**
   * Resistance factor when over-dragging (0-1)
   * Lower values = more resistance
   * Default: 0.5
   */
  overDragResistanceFactor?: number;

  /**
   * Enable handle panning gesture
   * When true, users can drag the handle to move the sheet
   * Default: true
   */
  enableHandlePanningGesture?: boolean;
  /**
   * Footer component to render at the bottom of the bottom sheet
   * Default: undefined
   */
  footerComponent?: React.FC<BottomSheetFooterProps>;

  /**
   * Keyboard behavior when the keyboard is shown
   * Default: 'interactive'
   */
  keyboardBehavior?: 'interactive' | 'extend' | 'fillParent';

  /**
   * Keyboard blur behavior when the keyboard is dismissed
   * Default: 'restore'
   */
  keyboardBlurBehavior?: 'none' | 'restore';

  /**
   * Gesture offset thresholds for the bottom sheet's pan gesture.
   * Useful for allowing horizontal gestures (e.g. swipeable tabs) to pass through.
   */
  activeOffsetX?: number | [number, number];
  activeOffsetY?: number | [number, number];
  failOffsetX?: number | [number, number];
  failOffsetY?: number | [number, number];
}

export interface BottomSheetRef extends BottomSheetModalMethods {}

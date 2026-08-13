import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import BottomSheetComponent, {
  BottomSheetBackdrop,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

import {BottomSheetProps} from './types';

// Enough frames for layout to land on a slow device, short enough that a genuine
// failure surfaces immediately rather than looking like a hang.
const OPEN_ATTEMPTS = 6;
const OPEN_RETRY_MS = 50;

export const BottomSheet: React.FC<BottomSheetProps> = ({
  visible,
  onClose,
  children,
  initialSnapPoint = 50,
  allowFullExpand = true,
  snapPoints: customSnapPoints,
  showBackdrop = true,
  onBackdropPress,
  enablePanDownToClose = true,
  backgroundColor = colors.white,
  showHandle = true,
  index: initialIndex = 0,
  animationDuration = 300,
  skipBottomSheetView = false,
  enableContentPanningGesture = true,
  enableDynamicSizing = true,
  enableOverDrag = true,
  overDragResistanceFactor = 0.5,
  enableHandlePanningGesture = true,
  footerComponent,
  keyboardBehavior = 'interactive',
  keyboardBlurBehavior = 'restore',
  activeOffsetX,
  activeOffsetY,
  failOffsetX,
  failOffsetY,
}) => {
  const bottomSheetRef = useRef<BottomSheetComponent>(null);
  const insets = useSafeAreaInsets();

  // --- Bottomsheet Refs ---
  // This block creates refs to hold the current index of the BottomSheet and
  // to always have the latest `onClose` and `onBackdropPress` callbacks.
  // These refs are used to avoid stale closures inside callbacks or effects.
  const currentIndexRef = useRef<number>(-1); // Tracks the current BottomSheet index.
  const onCloseRef = useRef(onClose); // Holds the latest onClose callback.
  onCloseRef.current = onClose; // Updates the ref to the latest prop.
  const onBackdropPressRef = useRef(onBackdropPress); // Holds the latest onBackdropPress callback.
  onBackdropPressRef.current = onBackdropPress; // Updates the ref to the latest prop.

  const snapPoints = useMemo(() => {
    if (customSnapPoints) {
      return customSnapPoints;
    }

    const points: (string | number)[] = [];

    // Convert initialSnapPoint to percentage string if it's a number
    const initialPoint =
      typeof initialSnapPoint === 'number'
        ? `${initialSnapPoint}%`
        : initialSnapPoint;

    points.push(initialPoint);

    // Add full expand point if allowed
    if (allowFullExpand) {
      points.push('80%'); // Max 80% of screen height
    }

    return points;
  }, [customSnapPoints, initialSnapPoint, allowFullExpand]);

  // Handle visibility changes via ref methods.
  //
  // `snapToIndex` is a SILENT no-op until @gorhom/bottom-sheet has resolved its snap
  // points from layout — see `useAnimatedDetents`, which returns no detents at all
  // while the container is unmeasured, or (with `enableDynamicSizing`) while the
  // content has not reported a height. A single dropped call leaves this component
  // closed while the caller's `visible` stays true: `onChange` never fires, so
  // `onClose` never runs, and every further tap is a state write that changes
  // nothing. The control reads as dead until the user leaves the screen. So retry
  // for a few frames, and say so in dev if it never takes.
  useEffect(() => {
    if (!visible) {
      if (currentIndexRef.current !== -1) {
        bottomSheetRef.current?.close();
      }
      return;
    }

    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tryOpen = () => {
      if (currentIndexRef.current !== -1) return; // already open
      bottomSheetRef.current?.snapToIndex(initialIndex);
      attempts += 1;

      if (attempts >= OPEN_ATTEMPTS) {
        if (__DEV__ && currentIndexRef.current === -1) {
          console.warn(
            '[BottomSheet] asked to open but the sheet stayed closed after ' +
              `${OPEN_ATTEMPTS} attempts. Its snap points never resolved — with ` +
              'enableDynamicSizing the content must report a height, which a bare ' +
              'ScrollView or FlatList child never does.',
          );
        }
        return;
      }

      timer = setTimeout(tryOpen, OPEN_RETRY_MS);
    };

    tryOpen();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [visible, initialIndex]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
        onPress={onBackdropPressRef.current}
      />
    ),
    [],
  );

  const handleSheetChanges = useCallback((index: number) => {
    currentIndexRef.current = index;
    if (index === -1) {
      onCloseRef.current();
    }
  }, []);

  // Always render the component, control visibility via index
  // Start closed (-1) and open when visible becomes true
  return (
    <BottomSheetComponent
      ref={bottomSheetRef}
      index={-1}
      snapPoints={enableDynamicSizing ? undefined : snapPoints}
      enablePanDownToClose={enablePanDownToClose}
      enableContentPanningGesture={enableContentPanningGesture}
      enableDynamicSizing={enableDynamicSizing}
      enableOverDrag={enableOverDrag}
      footerComponent={footerComponent}
      overDragResistanceFactor={overDragResistanceFactor}
      enableHandlePanningGesture={enableHandlePanningGesture}
      backdropComponent={showBackdrop ? renderBackdrop : undefined}
      handleIndicatorStyle={showHandle ? styles.handleIndicator : undefined}
      backgroundStyle={[styles.background, {backgroundColor}]}
      onChange={handleSheetChanges}
      animateOnMount={false}
      animationConfigs={{
        duration: animationDuration,
      }}
      keyboardBehavior={keyboardBehavior}
      keyboardBlurBehavior={keyboardBlurBehavior}
      activeOffsetX={activeOffsetX}
      activeOffsetY={activeOffsetY}
      failOffsetX={failOffsetX}
      failOffsetY={failOffsetY}>
      {skipBottomSheetView ? (
        children
      ) : (
        <BottomSheetView
          style={[styles.content, {paddingBottom: insets.bottom}]}>
          {children}
        </BottomSheetView>
      )}
    </BottomSheetComponent>
  );
};

const styles = ScaledSheet.create({
  background: {
    borderTopLeftRadius: '16@ms',
    borderTopRightRadius: '16@ms',
  },
  handleIndicator: {
    backgroundColor: colors.ds.stroke.primary,
    width: '80@ms',
    height: '4@ms',
    marginTop: '8@mvs',
  },
  content: {
    flex: 1,
  },
});

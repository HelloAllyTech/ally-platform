import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import BottomSheetComponent, {
  BottomSheetBackdrop,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

import {BottomSheetProps} from './types';

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

  // Handle visibility changes via ref methods
  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.snapToIndex(initialIndex);
    } else {
      bottomSheetRef.current?.close();
    }
  }, [visible, initialIndex]);

  // Handle backdrop press
  const handleBackdropPress = useCallback(() => {
    if (onBackdropPress) {
      onBackdropPress();
    } else {
      onClose();
    }
  }, [onBackdropPress, onClose]);

  // Render backdrop
  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
        onPress={handleBackdropPress}
      />
    ),
    [handleBackdropPress],
  );

  // Handle sheet changes
  const handleSheetChanges = useCallback(
    (index: number) => {
      if (index === -1) {
        onClose();
      }
    },
    [onClose],
  );

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

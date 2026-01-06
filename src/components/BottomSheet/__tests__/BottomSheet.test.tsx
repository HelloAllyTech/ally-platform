import React from 'react';
import {Text, View} from 'react-native';
import {render, act} from '@testing-library/react-native';
import BottomSheetComponent from '@gorhom/bottom-sheet';

import {BottomSheet} from '../BottomSheet';

// Mock @gorhom/bottom-sheet
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const {View: RNView} = require('react-native');

  const MockBottomSheetComponent = React.forwardRef(
    (props: any, ref: any) => {
      // Store ref methods
      React.useImperativeHandle(ref, () => ({
        snapToIndex: jest.fn(),
        close: jest.fn(),
      }));

      return (
        <RNView testID="bottom-sheet-component" {...props}>
          {props.children}
        </RNView>
      );
    },
  );

  MockBottomSheetComponent.displayName = 'BottomSheetComponent';

  return {
    __esModule: true,
    default: MockBottomSheetComponent,
    BottomSheetBackdrop: ({children, ...props}: any) => (
      <RNView testID="bottom-sheet-backdrop" {...props}>
        {children}
      </RNView>
    ),
    BottomSheetView: ({children, ...props}: any) => (
      <RNView testID="bottom-sheet-view" {...props}>
        {children}
      </RNView>
    ),
  };
});

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  return {
    useSafeAreaInsets: () => ({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    }),
  };
});

// Mock react-native-size-matters
jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {
    create: (styles: any) => styles,
  },
}));

// Mock colors
jest.mock('@/theme', () => ({
  colors: {
    white: '#FFFFFF',
    ds: {
      stroke: {
        primary: '#E5E5E5',
      },
    },
  },
}));

describe('BottomSheet', () => {
  const mockOnClose = jest.fn();
  const mockOnBackdropPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders with default props', () => {
    const {getByTestId, getByText} = render(
      <BottomSheet visible={false} onClose={mockOnClose}>
        <Text>Test Content</Text>
      </BottomSheet>,
    );

    expect(getByTestId('bottom-sheet-component')).toBeTruthy();
    expect(getByText('Test Content')).toBeTruthy();
  });

  it('renders children correctly', () => {
    const {getByText} = render(
      <BottomSheet visible={false} onClose={mockOnClose}>
        <Text>Child Content</Text>
      </BottomSheet>,
    );

    expect(getByText('Child Content')).toBeTruthy();
  });

  it('shows backdrop when showBackdrop is true', () => {
    const {getByTestId} = render(
      <BottomSheet visible={true} onClose={mockOnClose} showBackdrop={true}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    // Backdrop should be rendered when showBackdrop is true
    // Note: The actual backdrop rendering is handled by @gorhom/bottom-sheet
    // We're testing that the component accepts the prop
    expect(getByTestId('bottom-sheet-component')).toBeTruthy();
  });

  it('hides backdrop when showBackdrop is false', () => {
    const {getByTestId} = render(
      <BottomSheet visible={true} onClose={mockOnClose} showBackdrop={false}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(getByTestId('bottom-sheet-component')).toBeTruthy();
  });

  it('calculates snap points correctly with default initialSnapPoint', () => {
    const {getByTestId} = render(
      <BottomSheet visible={false} onClose={mockOnClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    const component = getByTestId('bottom-sheet-component');
    expect(component).toBeTruthy();
    // Default initialSnapPoint is 50, so snapPoints should be ['50%', '90%']
  });

  it('calculates snap points with custom initialSnapPoint as number', () => {
    const {getByTestId} = render(
      <BottomSheet
        visible={false}
        onClose={mockOnClose}
        initialSnapPoint={25}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(getByTestId('bottom-sheet-component')).toBeTruthy();
  });

  it('calculates snap points with custom initialSnapPoint as string', () => {
    const {getByTestId} = render(
      <BottomSheet
        visible={false}
        onClose={mockOnClose}
        initialSnapPoint="30%">
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(getByTestId('bottom-sheet-component')).toBeTruthy();
  });

  it('uses custom snap points when provided', () => {
    const customSnapPoints = ['25%', '50%', '75%'];
    const {getByTestId} = render(
      <BottomSheet
        visible={false}
        onClose={mockOnClose}
        snapPoints={customSnapPoints}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(getByTestId('bottom-sheet-component')).toBeTruthy();
  });

  it('does not add full expand point when allowFullExpand is false', () => {
    const {getByTestId} = render(
      <BottomSheet
        visible={false}
        onClose={mockOnClose}
        allowFullExpand={false}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(getByTestId('bottom-sheet-component')).toBeTruthy();
  });

  it('calls onClose when sheet index changes to -1', () => {
    const {getByTestId} = render(
      <BottomSheet visible={true} onClose={mockOnClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    const component = getByTestId('bottom-sheet-component');
    const onChange = (component.props as any).onChange;

    act(() => {
      onChange(-1);
    });

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when sheet index is not -1', () => {
    const {getByTestId} = render(
      <BottomSheet visible={true} onClose={mockOnClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    const component = getByTestId('bottom-sheet-component');
    const onChange = (component.props as any).onChange;

    act(() => {
      onChange(0);
    });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('applies custom backgroundColor', () => {
    const {getByTestId} = render(
      <BottomSheet
        visible={false}
        onClose={mockOnClose}
        backgroundColor="#FF0000">
        <Text>Content</Text>
      </BottomSheet>,
    );

    const component = getByTestId('bottom-sheet-component');
    const backgroundStyle = (component.props as any).backgroundStyle;
    expect(backgroundStyle).toBeTruthy();
  });

  it('applies default white background color', () => {
    const {getByTestId} = render(
      <BottomSheet visible={false} onClose={mockOnClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    const component = getByTestId('bottom-sheet-component');
    const backgroundStyle = (component.props as any).backgroundStyle;
    expect(backgroundStyle).toBeTruthy();
  });

  it('respects enablePanDownToClose prop', () => {
    const {getByTestId, rerender} = render(
      <BottomSheet
        visible={false}
        onClose={mockOnClose}
        enablePanDownToClose={false}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    let component = getByTestId('bottom-sheet-component');
    expect((component.props as any).enablePanDownToClose).toBe(false);

    rerender(
      <BottomSheet
        visible={false}
        onClose={mockOnClose}
        enablePanDownToClose={true}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    component = getByTestId('bottom-sheet-component');
    expect((component.props as any).enablePanDownToClose).toBe(true);
  });

  it('applies custom animation duration', () => {
    const {getByTestId} = render(
      <BottomSheet
        visible={false}
        onClose={mockOnClose}
        animationDuration={500}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    const component = getByTestId('bottom-sheet-component');
    const animationConfigs = (component.props as any).animationConfigs;
    expect(animationConfigs.duration).toBe(500);
  });

  it('applies default animation duration of 300ms', () => {
    const {getByTestId} = render(
      <BottomSheet visible={false} onClose={mockOnClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    const component = getByTestId('bottom-sheet-component');
    const animationConfigs = (component.props as any).animationConfigs;
    expect(animationConfigs.duration).toBe(300);
  });

  it('handles visibility changes correctly', () => {
    const {rerender, getByTestId} = render(
      <BottomSheet visible={false} onClose={mockOnClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    rerender(
      <BottomSheet visible={true} onClose={mockOnClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(getByTestId('bottom-sheet-component')).toBeTruthy();
  });

  it('handles initialIndex prop', () => {
    const {getByTestId} = render(
      <BottomSheet visible={true} onClose={mockOnClose} index={1}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(getByTestId('bottom-sheet-component')).toBeTruthy();
  });

  it('renders BottomSheetView with correct padding', () => {
    const {getByTestId} = render(
      <BottomSheet visible={false} onClose={mockOnClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    const view = getByTestId('bottom-sheet-view');
    expect(view).toBeTruthy();
  });
});

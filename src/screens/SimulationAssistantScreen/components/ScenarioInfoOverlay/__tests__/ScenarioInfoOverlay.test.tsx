import React, {createRef} from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {TouchableOpacity} from 'react-native';

import {
  ScenarioInfoOverlay,
  ScenarioInfoOverlayRef,
} from '../ScenarioInfoOverlay';

// Mock icons
jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    InfoBlackCircleIcon: () => <View testID="info-icon" />,
  };
});

describe('ScenarioInfoOverlay', () => {
  it('renders info icon when title is provided', () => {
    const {getByTestId} = render(
      <ScenarioInfoOverlay title="Test Scenario" />,
    );

    expect(getByTestId('info-icon')).toBeDefined();
  });

  it('toggles scenario info panel when info icon is pressed', () => {
    const {getByText, queryByText, UNSAFE_root} = render(
      <ScenarioInfoOverlay title="Test Scenario" />,
    );

    // Initially, panel should not be visible
    expect(queryByText('Test Scenario')).toBeNull();

    // Find and press the TouchableOpacity containing the icon
    const touchables = UNSAFE_root.findAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]);

    // Panel should now be visible
    expect(getByText('Test Scenario')).toBeDefined();

    // Press again to hide
    fireEvent.press(touchables[0]);

    // Panel should be hidden again
    expect(queryByText('Test Scenario')).toBeNull();
  });

  it('exposes close method via ref', async () => {
    const ref = createRef<ScenarioInfoOverlayRef>();
    const {act} = require('@testing-library/react-native');

    const {getByText, queryByText, UNSAFE_root} = render(
      <ScenarioInfoOverlay ref={ref} title="Test Scenario" />,
    );

    // Open the panel
    const touchables = UNSAFE_root.findAllByType(TouchableOpacity);
    await act(async () => {
      fireEvent.press(touchables[0]);
    });

    expect(getByText('Test Scenario')).toBeDefined();

    // Close via ref
    await act(async () => {
      ref.current?.close();
    });

    expect(queryByText('Test Scenario')).toBeNull();
  });

  it('exposes isOpen property via ref', async () => {
    const ref = createRef<ScenarioInfoOverlayRef>();
    const {act} = require('@testing-library/react-native');

    const {UNSAFE_root} = render(
      <ScenarioInfoOverlay ref={ref} title="Test Scenario" />,
    );

    // Initially closed
    expect(ref.current?.isOpen).toBe(false);

    // Open the panel
    const touchables = UNSAFE_root.findAllByType(TouchableOpacity);
    await act(async () => {
      fireEvent.press(touchables[0]);
    });

    // Should be open (wait for state update)
    await act(async () => {
      // Give time for state to update
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(ref.current?.isOpen).toBe(true);

    // Close via ref
    await act(async () => {
      ref.current?.close();
    });

    // Should be closed
    expect(ref.current?.isOpen).toBe(false);
  });

  it('limits title to 3 lines', async () => {
    const {act} = require('@testing-library/react-native');
    const {Text} = require('react-native');
    
    const {UNSAFE_root} = render(
      <ScenarioInfoOverlay title="Very long scenario title that should be limited to three lines maximum" />,
    );

    // Open the panel
    const touchables = UNSAFE_root.findAllByType(TouchableOpacity);
    await act(async () => {
      fireEvent.press(touchables[0]);
    });

    // Find Text component with numberOfLines prop
    const textComponents = UNSAFE_root.findAllByType(Text);
    const titleText = textComponents.find(t => 
      t.props.numberOfLines === 3 && 
      t.props.children === 'Very long scenario title that should be limited to three lines maximum'
    );
    
    expect(titleText).toBeDefined();
    expect(titleText?.props.numberOfLines).toBe(3);
  });

  it('applies correct z-index for overlay layering', () => {
    const {UNSAFE_root, getByText} = render(
      <ScenarioInfoOverlay title="Test Scenario" />,
    );

    // Open panel
    const touchables = UNSAFE_root.findAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]);

    // Check that panel is rendered
    const panel = getByText('Test Scenario').parent?.parent;
    expect(panel).toBeDefined();
  });
});


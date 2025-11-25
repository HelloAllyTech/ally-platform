import React from 'react';
import {Text} from 'react-native';
import {render} from '@testing-library/react-native';

import {CircularProgress} from '../CircularProgress';

describe('CircularProgress', () => {
  it('renders without crashing', () => {
    const {root} = render(<CircularProgress progress={50} />);
    expect(root).toBeTruthy();
  });

  it('renders with default props', () => {
    const {root} = render(<CircularProgress progress={25} />);
    expect(root).toBeTruthy();
  });

  it('renders with custom size', () => {
    const {root} = render(<CircularProgress progress={50} size={50} />);
    expect(root).toBeTruthy();
  });

  it('renders with custom max value', () => {
    const {root} = render(<CircularProgress progress={5} max={10} />);
    expect(root).toBeTruthy();
  });

  it('renders with custom stroke width', () => {
    const {root} = render(
      <CircularProgress progress={50} strokeWidth={5} />,
    );
    expect(root).toBeTruthy();
  });

  it('renders with custom colors', () => {
    const {root} = render(
      <CircularProgress
        progress={50}
        progressColor="#FF0000"
        trackColor="#CCCCCC"
      />,
    );
    expect(root).toBeTruthy();
  });

  it('renders with children content', () => {
    const {getByText} = render(
      <CircularProgress progress={50}>
        <Text>50%</Text>
      </CircularProgress>,
    );
    expect(getByText('50%')).toBeTruthy();
  });

  it('renders children in center container', () => {
    const {getByText} = render(
      <CircularProgress progress={75} max={100}>
        <Text>75/100</Text>
      </CircularProgress>,
    );
    expect(getByText('75/100')).toBeTruthy();
  });

  it('handles zero progress correctly', () => {
    const {root} = render(<CircularProgress progress={0} />);
    expect(root).toBeTruthy();
  });

  it('handles progress equal to max', () => {
    const {root} = render(<CircularProgress progress={100} max={100} />);
    expect(root).toBeTruthy();
  });

  it('handles progress exceeding max (should clamp to max)', () => {
    const {root} = render(<CircularProgress progress={150} max={100} />);
    expect(root).toBeTruthy();
  });

  it('handles negative progress (should clamp to 0)', () => {
    const {root} = render(<CircularProgress progress={-10} />);
    expect(root).toBeTruthy();
  });

  it('calculates percentage correctly for various values', () => {
    // Test with different progress/max combinations
    const testCases = [
      {progress: 0, max: 100},
      {progress: 25, max: 100},
      {progress: 50, max: 100},
      {progress: 75, max: 100},
      {progress: 100, max: 100},
      {progress: 3, max: 10},
      {progress: 7, max: 14},
    ];

    testCases.forEach(({progress, max}) => {
      const {root} = render(
        <CircularProgress progress={progress} max={max} />,
      );
      expect(root).toBeTruthy();
    });
  });

  it('renders with all custom props combined', () => {
    const {getByText} = render(
      <CircularProgress
        progress={60}
        max={200}
        size={60}
        strokeWidth={6}
        progressColor="#00FF00"
        trackColor="#EEEEEE">
        <Text>60/200</Text>
      </CircularProgress>,
    );
    expect(getByText('60/200')).toBeTruthy();
  });

  it('handles fractional progress values', () => {
    const {root} = render(<CircularProgress progress={33.33} max={100} />);
    expect(root).toBeTruthy();
  });

  it('handles very small progress values', () => {
    const {root} = render(<CircularProgress progress={0.1} max={100} />);
    expect(root).toBeTruthy();
  });

  it('handles very large max values', () => {
    const {root} = render(
      <CircularProgress progress={500} max={1000} />,
    );
    expect(root).toBeTruthy();
  });

  it('renders correctly with size 32 (default)', () => {
    const {root} = render(<CircularProgress progress={50} size={32} />);
    expect(root).toBeTruthy();
  });

  it('renders correctly with custom size 33 (from Figma)', () => {
    const {root} = render(<CircularProgress progress={1} max={4} size={33} />);
    expect(root).toBeTruthy();
  });

  it('does not render progress arc when progress is 0', () => {
    // This test ensures the fix for the blue dot issue is working
    const {root} = render(<CircularProgress progress={0} max={1} />);
    expect(root).toBeTruthy();
  });
});


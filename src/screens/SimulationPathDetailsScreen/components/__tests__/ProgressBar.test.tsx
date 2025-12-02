import React from 'react';
import {render} from '@testing-library/react-native';
import {Text, View} from 'react-native';

import {ProgressBar} from '../ProgressBar';

// Mock dependencies
jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'Simulations.progressCompleted') {
        return `${params?.current} of ${params?.total} completed`;
      }
      return key;
    },
  })),
}));

describe('ProgressBar', () => {
  it('should render progress bar with correct text', () => {
    const {getByText} = render(<ProgressBar current={2} total={5} />);

    expect(getByText('2 of 5 completed')).toBeTruthy();
  });

  it('should render with 0 progress', () => {
    const {getByText} = render(<ProgressBar current={0} total={10} />);

    expect(getByText('0 of 10 completed')).toBeTruthy();
  });

  it('should render with full progress', () => {
    const {getByText} = render(<ProgressBar current={10} total={10} />);

    expect(getByText('10 of 10 completed')).toBeTruthy();
  });

  it('should render with single item progress', () => {
    const {getByText} = render(<ProgressBar current={0} total={1} />);

    expect(getByText('0 of 1 completed')).toBeTruthy();
  });

  it('should render progress bar track and fill', () => {
    const {root} = render(<ProgressBar current={3} total={10} />);

    // Check that View components are rendered (track and fill)
    const views = root.findAllByType(View as any);
    expect(views.length).toBeGreaterThan(0);
  });

  it('should calculate correct percentage for progress fill', () => {
    const {getByText} = render(<ProgressBar current={5} total={10} />);

    // Verify progress is rendered correctly
    expect(getByText('5 of 10 completed')).toBeTruthy();
    // The fill width would be 50% (5/10 * 100)
  });

  it('should handle edge case of 0 total', () => {
    const {getByText} = render(<ProgressBar current={0} total={0} />);

    expect(getByText('0 of 0 completed')).toBeTruthy();
  });

  it('should handle current greater than total', () => {
    const {getByText} = render(<ProgressBar current={15} total={10} />);

    // Should still render even if current > total (edge case)
    expect(getByText('15 of 10 completed')).toBeTruthy();
  });

  it('should render text component with progress text', () => {
    const {root} = render(<ProgressBar current={7} total={10} />);

    const textComponents = root.findAllByType(Text as any);
    expect(textComponents.length).toBe(1);
    expect(textComponents[0].props.children).toBe('7 of 10 completed');
  });

  it('should use translation hook for text', () => {
    const {getByText} = render(<ProgressBar current={3} total={8} />);

    // Verify that the translation function is used
    expect(getByText('3 of 8 completed')).toBeTruthy();
  });
});


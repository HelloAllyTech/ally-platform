import React from 'react';
import {render} from '@testing-library/react-native';

import {ProgressBar} from '../ProgressBar';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

describe('ProgressBar', () => {
  it('renders progress text with translation key', () => {
    const {getByText} = render(<ProgressBar current={2} total={5} />);

    expect(getByText('simulations.progressCompleted')).toBeTruthy();
  });

  it('hides text when isProgressTextVisible=false', () => {
    const {queryByText} = render(
      <ProgressBar
        current={2}
        total={5}
        isProgressTextVisible={false}
      />,
    );

    expect(queryByText(/simulations\.progressCompleted/)).toBeNull();
  });

  it('shows custom progressText when provided', () => {
    const {getByText} = render(
      <ProgressBar
        current={3}
        total={10}
        progressText="Custom 3/10"
      />,
    );

    expect(getByText('Custom 3/10')).toBeTruthy();
  });

  it('renders fill with correct width percentage', () => {
    const {UNSAFE_root} = render(
      <ProgressBar current={2} total={4} />,
    );

    const fillView = UNSAFE_root.findAllByType(
      require('react-native').View,
    ).find((node: {props?: {style?: unknown}}) => {
      const nodeStyle = node.props?.style;
      const style = Array.isArray(nodeStyle)
        ? nodeStyle
        : nodeStyle
          ? [nodeStyle]
          : [];
      return style.some(
        (s: {width?: string}) => s && typeof s.width === 'string' && s.width === '50%',
      );
    });

    expect(fillView).toBeTruthy();
  });

  it('renders without crashing', () => {
    const {toJSON} = render(<ProgressBar current={0} total={10} />);

    expect(toJSON()).toBeTruthy();
  });

  it('handles total of 0', () => {
    const {getByText} = render(<ProgressBar current={5} total={0} />);

    expect(getByText('simulations.progressCompleted')).toBeTruthy();
  });
});

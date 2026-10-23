import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SessionGlimpse} from '../SessionGlimpse';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ArrowRight: (props: any) =>
      React.createElement(View, {...props, testID: 'arrow-right'}),
  };
});

describe('SessionGlimpse', () => {
  it('renders header text', () => {
    const {getByText} = render(
      <SessionGlimpse content="Some content" />,
    );

    expect(getByText('callFeedback.sessionGlimpse')).toBeTruthy();
  });

  it('shows content when expanded (default)', () => {
    const content = 'Session transcript preview';
    const {getByText} = render(<SessionGlimpse content={content} />);

    expect(getByText(content)).toBeTruthy();
  });

  it('hides content when collapsed (after press)', () => {
    const content = 'Hidden content';
    const {getByText, queryByText} = render(<SessionGlimpse content={content} />);

    expect(getByText(content)).toBeTruthy();

    fireEvent.press(getByText('callFeedback.sessionGlimpse'));

    expect(queryByText(content)).toBeNull();
  });

  it('re-shows content when expanded again', () => {
    const content = 'Toggle content';
    const {getByText, queryByText} = render(<SessionGlimpse content={content} />);

    fireEvent.press(getByText('callFeedback.sessionGlimpse'));
    expect(queryByText(content)).toBeNull();

    fireEvent.press(getByText('callFeedback.sessionGlimpse'));
    expect(getByText(content)).toBeTruthy();
  });
});

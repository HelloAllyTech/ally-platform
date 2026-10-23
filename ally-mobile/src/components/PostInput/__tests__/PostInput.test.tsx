import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {PostInput} from '../PostInput';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

describe('PostInput', () => {
  it('disables submit when the value is empty', () => {
    const onSubmit = jest.fn();
    const {getByTestId} = render(
      <PostInput
        value=""
        onChangeText={jest.fn()}
        onSubmit={onSubmit}
        maxLength={4000}
      />,
    );

    fireEvent.press(getByTestId('post-input-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables submit when the value is only whitespace', () => {
    const onSubmit = jest.fn();
    const {getByTestId} = render(
      <PostInput
        value="   "
        onChangeText={jest.fn()}
        onSubmit={onSubmit}
        maxLength={4000}
      />,
    );

    fireEvent.press(getByTestId('post-input-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables submit when the value is over the character limit', () => {
    const onSubmit = jest.fn();
    const {getByTestId} = render(
      <PostInput
        value={'a'.repeat(10)}
        onChangeText={jest.fn()}
        onSubmit={onSubmit}
        maxLength={5}
      />,
    );

    expect(getByTestId('post-input-char-count').props.children.join('')).toContain(
      '10/5',
    );
    fireEvent.press(getByTestId('post-input-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('enables submit for valid content and calls onSubmit', () => {
    const onSubmit = jest.fn();
    const {getByTestId} = render(
      <PostInput
        value="A thoughtful reply"
        onChangeText={jest.fn()}
        onSubmit={onSubmit}
        maxLength={4000}
      />,
    );

    fireEvent.press(getByTestId('post-input-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows a Cancel action only when onCancel is provided', () => {
    const {queryByTestId, rerender} = render(
      <PostInput value="" onChangeText={jest.fn()} onSubmit={jest.fn()} maxLength={4000} />,
    );
    expect(queryByTestId('post-input-cancel')).toBeNull();

    rerender(
      <PostInput
        value=""
        onChangeText={jest.fn()}
        onSubmit={jest.fn()}
        maxLength={4000}
        onCancel={jest.fn()}
      />,
    );
    expect(queryByTestId('post-input-cancel')).not.toBeNull();
  });
});

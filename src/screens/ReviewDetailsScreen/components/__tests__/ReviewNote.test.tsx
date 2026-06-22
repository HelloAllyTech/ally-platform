import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ReviewNote} from '../ReviewNote';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    EditSquareIcon: (props: object) =>
      React.createElement(View, {testID: 'edit-square-icon', ...props}),
  };
});

describe('ReviewNote', () => {
  it('renders note text', () => {
    const {getByText} = render(
      <ReviewNote note="This is my review note." />,
    );
    expect(getByText('This is my review note.')).toBeTruthy();
  });

  it('renders title', () => {
    const {getByText} = render(
      <ReviewNote note="Test note" />,
    );
    expect(getByText('review.details.noteLabel')).toBeTruthy();
  });

  it('shows edit button when onEditNote provided', () => {
    const onEditNote = jest.fn();
    const {getByTestId} = render(
      <ReviewNote note="Note" onEditNote={onEditNote} />,
    );
    expect(getByTestId('edit-square-icon')).toBeTruthy();
  });

  it('does not show edit button when onEditNote not provided', () => {
    const {queryByTestId} = render(<ReviewNote note="Note" />);
    expect(queryByTestId('edit-square-icon')).toBeNull();
  });

  it('calls onEditNote when edit button pressed', () => {
    const onEditNote = jest.fn();
    const {getByTestId} = render(
      <ReviewNote note="Note" onEditNote={onEditNote} />,
    );
    fireEvent.press(getByTestId('edit-square-icon'));
    expect(onEditNote).toHaveBeenCalledTimes(1);
  });
});

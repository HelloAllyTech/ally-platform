import React from 'react';
import {render} from '@testing-library/react-native';

import {EmptyState} from '../EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    const {getByText} = render(<EmptyState title="No items" />);
    expect(getByText('No items')).toBeTruthy();
  });

  it('renders description when provided', () => {
    const {getByText} = render(
      <EmptyState title="Empty" description="Add something to get started." />,
    );
    expect(getByText('Add something to get started.')).toBeTruthy();
  });

  it('does not render description when not provided', () => {
    const {queryByText} = render(<EmptyState title="Empty" />);
    expect(queryByText('Add something')).toBeNull();
  });

  it('renders icon when provided', () => {
    const React = require('react');
    const {Text} = require('react-native');
    const Icon = () => React.createElement(Text, {testID: 'empty-icon'}, 'Icon');
    const {getByTestId} = render(
      <EmptyState title="Empty" icon={Icon} />,
    );
    expect(getByTestId('empty-icon')).toBeTruthy();
  });

  it('does not render icon when not provided', () => {
    const {queryByTestId} = render(<EmptyState title="Empty" />);
    expect(queryByTestId('empty-icon')).toBeNull();
  });

  it('applies containerStyle when provided', () => {
    const {toJSON} = render(
      <EmptyState title="Empty" containerStyle={{padding: 20}} />,
    );
    expect(toJSON()).not.toBeNull();
  });
});

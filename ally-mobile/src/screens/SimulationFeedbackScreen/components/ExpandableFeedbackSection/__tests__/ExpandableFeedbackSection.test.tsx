import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ExpandableFeedbackSection} from '../ExpandableFeedbackSection';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ArrowDown: (props: any) =>
      React.createElement(View, {...props, testID: 'arrow-down'}),
  };
});

describe('ExpandableFeedbackSection', () => {
  it('renders title', () => {
    const {getByText} = render(
      <ExpandableFeedbackSection title="Section Title" items={[]} />,
    );

    expect(getByText('Section Title')).toBeTruthy();
  });

  it('shows only first 3 items by default', () => {
    const items = ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5'];
    const {getByText, queryByText} = render(
      <ExpandableFeedbackSection title="Title" items={items} />,
    );

    expect(getByText('Item 1')).toBeTruthy();
    expect(getByText('Item 2')).toBeTruthy();
    expect(getByText('Item 3')).toBeTruthy();
    expect(queryByText('Item 4')).toBeNull();
    expect(queryByText('Item 5')).toBeNull();
  });

  it('shows all items after pressing view more', () => {
    const items = ['Item 1', 'Item 2', 'Item 3', 'Item 4'];
    const {getByText, queryByText} = render(
      <ExpandableFeedbackSection title="Title" items={items} />,
    );

    expect(queryByText('Item 4')).toBeNull();

    fireEvent.press(getByText('common.viewMore'));

    expect(getByText('Item 4')).toBeTruthy();
  });

  it('collapses back on view less', () => {
    const items = ['Item 1', 'Item 2', 'Item 3', 'Item 4'];
    const {getByText, queryByText} = render(
      <ExpandableFeedbackSection title="Title" items={items} />,
    );

    fireEvent.press(getByText('common.viewMore'));
    expect(getByText('Item 4')).toBeTruthy();

    fireEvent.press(getByText('common.viewLess'));
    expect(queryByText('Item 4')).toBeNull();
  });

  it('shows no data text when items empty', () => {
    const {getByText} = render(
      <ExpandableFeedbackSection title="Title" items={[]} />,
    );

    expect(getByText('postSim.feedback.noData')).toBeTruthy();
  });

  it('respects custom collapsedItemCount', () => {
    const items = ['A', 'B', 'C', 'D'];
    const {getByText, queryByText} = render(
      <ExpandableFeedbackSection
        title="Title"
        items={items}
        collapsedItemCount={2}
      />,
    );

    expect(getByText('A')).toBeTruthy();
    expect(getByText('B')).toBeTruthy();
    expect(queryByText('C')).toBeNull();
    expect(queryByText('D')).toBeNull();
  });

  it('does not show view more when items.length <= collapsedItemCount', () => {
    const items = ['Item 1', 'Item 2', 'Item 3'];
    const {queryByText} = render(
      <ExpandableFeedbackSection title="Title" items={items} />,
    );

    expect(queryByText('common.viewMore')).toBeNull();
    expect(queryByText('common.viewLess')).toBeNull();
  });
});

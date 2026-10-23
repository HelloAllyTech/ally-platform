import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {Text, View} from 'react-native';

import {CallLogHeader} from '@/screens/CallLog/components/CallLogHeader/CallLogHeader';

jest.mock('@/assets/icons', () => ({ReplayIcon: () => null}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    TabScreenHeader: ({
      title,
      subtitle,
      rightContent,
    }: {
      title: string;
      subtitle?: string;
      rightContent?: React.ReactNode;
    }) => (
      <View testID="tab-screen-header">
        <TouchableOpacity testID="hamburger-button">
          <Text>Menu</Text>
        </TouchableOpacity>
        <Text>{title}</Text>
        {subtitle && <Text>{subtitle}</Text>}
        {rightContent}
      </View>
    ),
  };
});

describe('CallLogHeader', () => {
  it('renders with title and subtitle', () => {
    const {getByText} = render(
      <CallLogHeader
        search=""
        onSearchChange={() => {}}
        title="calls.header.title"
        subtitle="calls.header.subtitle"
      />,
    );
    expect(getByText('calls.header.title')).toBeTruthy();
    expect(getByText('calls.header.subtitle')).toBeTruthy();
  });

  it('renders TabScreenHeader component', () => {
    const {getByTestId} = render(
      <CallLogHeader
        search=""
        onSearchChange={() => {}}
        title="calls.header.title"
      />,
    );
    expect(getByTestId('tab-screen-header')).toBeTruthy();
  });

  it('calls onRefresh when refresh is pressed', () => {
    const onRefresh = jest.fn();
    const {getByLabelText} = render(
      <CallLogHeader
        search=""
        onSearchChange={() => {}}
        onRefresh={onRefresh}
        isFetching={false}
      />,
    );
    fireEvent.press(getByLabelText('Refresh'));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('renders without title when title is not passed', () => {
    const {getByTestId, queryByText} = render(
      <CallLogHeader search="" onSearchChange={() => {}} />,
    );
    expect(getByTestId('tab-screen-header')).toBeTruthy();
    expect(queryByText('calls.header.title')).toBeNull();
  });
});

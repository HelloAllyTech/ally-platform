import React, {useEffect} from 'react';
import {render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {Carousel} from '@/components/Carousel/Carousel';

jest.mock('react-native-reanimated-carousel', () => {
  const React = require('react');
  const {View} = require('react-native');
  const Mock = ({data, renderItem, onSnapToItem}: any) => {
    React.useEffect(() => {
      onSnapToItem?.(1);
    }, [onSnapToItem]);
    return React.createElement(
      View,
      null,
      data && data.length > 0 ? renderItem({item: data[0], index: 0}) : null,
    );
  };
  return Mock;
});

describe('Carousel', () => {
  it('renders first item and calls onSnapToItem', () => {
    const onSnap = jest.fn();
    const {getByText} = render(
      <Carousel
        data={[{id: 1, label: 'A'}]}
        renderItem={(item: any) => <Text>{item.label}</Text>}
        onSnapToItem={onSnap}
        testID="carousel"
      />,
    );

    expect(getByText('A')).toBeTruthy();
    expect(onSnap).toHaveBeenCalledWith(1);
  });
});

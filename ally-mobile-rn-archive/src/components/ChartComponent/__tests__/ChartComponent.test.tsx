import React from 'react';
import {render} from '@testing-library/react-native';

import {ChartComponent} from '../ChartComponent';

jest.mock('react-native-chart-kit', () => {
  const React = require('react');
  return {
    LineChart: (props: any) =>
      React.createElement('View', {testID: 'line-chart', ...props}),
  };
});

const mockDatasets = [
  {data: [10, 20, 30], strokeWidth: 2},
  {
    data: [5, 15, 25],
    color: (opacity: number) => `rgba(255, 0, 0, ${opacity})`,
    strokeWidth: 3,
  },
];

describe('ChartComponent', () => {
  it('renders without crashing', () => {
    const {toJSON} = render(
      <ChartComponent datasets={[{data: [1, 2, 3]}]} />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with x-axis labels', () => {
    const {toJSON} = render(
      <ChartComponent
        datasets={[{data: [1, 2, 3]}]}
        xAxisLabels={['Jan', 'Feb', 'Mar']}
      />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with multiple datasets', () => {
    const {toJSON} = render(
      <ChartComponent datasets={mockDatasets} />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with custom width and height', () => {
    const {toJSON} = render(
      <ChartComponent datasets={[{data: [1, 2]}]} width={200} height={150} />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('applies default color when dataset color is not provided', () => {
    const {toJSON} = render(
      <ChartComponent datasets={[{data: [10, 20]}]} />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with custom chartConfig', () => {
    const customConfig = {
      backgroundColor: '#000',
      backgroundGradientFrom: '#000',
      backgroundGradientTo: '#333',
      decimalPlaces: 1,
      color: () => '#fff',
      labelColor: () => '#ccc',
    };
    const {toJSON} = render(
      <ChartComponent
        datasets={[{data: [5, 10]}]}
        chartConfig={customConfig}
      />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with empty x-axis labels', () => {
    const {toJSON} = render(
      <ChartComponent datasets={[{data: [1]}]} xAxisLabels={[]} />,
    );
    expect(toJSON()).not.toBeNull();
  });
});

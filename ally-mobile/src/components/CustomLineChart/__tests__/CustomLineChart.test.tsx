import React from 'react';
import {render} from '@testing-library/react-native';

import {CustomLineChart} from '../CustomLineChart';

jest.mock('@wuba/react-native-echarts', () => {
  const React = require('react');
  const SkiaChart = React.forwardRef((_props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({}));
    return React.createElement('View', {testID: 'skia-chart'});
  });
  return {
    __esModule: true,
    SkiaChart,
    SkiaRenderer: {},
  };
});

jest.mock('echarts/core', () => ({
  use: jest.fn(),
  init: jest.fn(() => ({
    setOption: jest.fn(),
    dispose: jest.fn(),
  })),
}));

jest.mock('echarts/charts', () => ({LineChart: {}}));
jest.mock('echarts/components', () => ({
  GridComponent: {},
  TooltipComponent: {},
}));

const mockData = [
  {x: 0, y: 0},
  {x: 60, y: 2},
  {x: 120, y: -1},
  {x: 180, y: 3},
];

describe('CustomLineChart', () => {
  it('renders without crashing', () => {
    const {toJSON} = render(<CustomLineChart data={mockData} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders with custom dimensions', () => {
    const {toJSON} = render(
      <CustomLineChart data={mockData} width={200} height={150} />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with empty data', () => {
    const {toJSON} = render(<CustomLineChart data={[]} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders with custom y-axis range', () => {
    const {toJSON} = render(
      <CustomLineChart data={mockData} yAxisMin={-10} yAxisMax={10} />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with custom format function', () => {
    const formatXLabel = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    const {toJSON} = render(
      <CustomLineChart data={mockData} formatXLabel={formatXLabel} />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with custom line color', () => {
    const {toJSON} = render(
      <CustomLineChart data={mockData} lineColor="#ff0000" />,
    );
    expect(toJSON()).not.toBeNull();
  });
});

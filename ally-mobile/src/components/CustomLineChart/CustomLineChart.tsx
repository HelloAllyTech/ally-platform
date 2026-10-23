import React, {useEffect, useMemo, useRef} from 'react';
import {SkiaChart, SkiaRenderer} from '@wuba/react-native-echarts';
import {LineChart} from 'echarts/charts';
import {GridComponent, TooltipComponent} from 'echarts/components';
import * as echarts from 'echarts/core';
import {StyleSheet, View, ViewStyle} from 'react-native';

import {colors} from '@/theme';

echarts.use([SkiaRenderer, LineChart, GridComponent, TooltipComponent]);

export type DataPoint = {
  x: number;
  y: number;
};

type Props = {
  data: DataPoint[];
  width?: number;
  height?: number;
  style?: ViewStyle;
  yAxisMin?: number;
  yAxisMax?: number;
  formatXLabel?: (value: number) => string;
  lineColor?: string;
  xAxisSplitNumber?: number;
  yAxisSplitNumber?: number;
};

const DEFAULT_LINE_COLOR = colors.ds.green[400];

export const CustomLineChart: React.FC<Props> = ({
  data,
  width = 360,
  height = 220,
  style,
  yAxisMin = -5,
  yAxisMax = 5,
  formatXLabel,
  lineColor = DEFAULT_LINE_COLOR,
  xAxisSplitNumber = 4,
  yAxisSplitNumber = 4,
}) => {
  // `SkiaChart` is the component itself, not a type — the old annotation was
  // a value in type position. The library declares its ref as `any`, so derive
  // the instance type from the component rather than inventing a shape for it.
  const skiaRef = useRef<React.ComponentRef<typeof SkiaChart>>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);

  const {seriesData, maxX} = useMemo(() => {
    const sorted = [...(data ?? [])]
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      .sort((a, b) => a.x - b.x);

    const series: Array<[number, number]> = sorted.map(p => [p.x, p.y]);
    const max = sorted.length ? sorted[sorted.length - 1].x : 0;

    return {seriesData: series, maxX: max};
  }, [data]);

  const option = useMemo(() => {
    return {
      backgroundColor: colors.white,
      animation: false,

      grid: {
        left: 14,
        right: 14,
        top: 10,
        bottom: 26,
        containLabel: true,
      },

      xAxis: {
        type: 'value',
        min: 0,
        max: maxX || 1,
        splitNumber: xAxisSplitNumber,

        axisLabel: {
          color: colors.ds.typography.mediumEmphasis,
          fontSize: 12,
          ...(formatXLabel && {
            formatter: (v: number) => formatXLabel(v),
          }),
          margin: 12,
        },

        axisLine: {show: false},
        axisTick: {show: false},

        splitLine: {
          show: true,
          lineStyle: {
            color: colors.ds.stroke.primary,
            width: 1,
            type: 'dashed',
          },
        },
      },

      yAxis: {
        type: 'value',
        min: yAxisMin,
        max: yAxisMax,
        splitNumber: yAxisSplitNumber,

        axisLabel: {
          color: colors.ds.typography.mediumEmphasis,
          fontSize: 12,
          margin: 12,
        },

        axisLine: {show: false},
        axisTick: {show: false},

        splitLine: {
          show: true,
          lineStyle: {
            color: colors.ds.stroke.primary,
            width: 1,
            type: 'dashed',
          },
        },
      },

      series: [
        {
          type: 'line',
          data: seriesData,
          smooth: true,

          lineStyle: {
            width: 1,
            color: lineColor,
            cap: 'round',
            join: 'round',
          },

          showSymbol: true,
          symbol: 'circle',
          symbolSize: 2,
          itemStyle: {
            color: colors.white,
            borderColor: lineColor,
            borderWidth: 4,
          },

          emphasis: {focus: 'series'},
        },
      ],
    };
  }, [
    maxX,
    seriesData,
    yAxisMin,
    yAxisMax,
    formatXLabel,
    lineColor,
    xAxisSplitNumber,
    yAxisSplitNumber,
  ]);

  useEffect(() => {
    if (!skiaRef.current) return;

    const chart = echarts.init(skiaRef.current, 'light', {
      renderer: 'skia' as unknown as 'canvas',
      width,
      height,
    });

    chartRef.current = chart;
    chart.setOption(option);

    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [width, height, option]);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.setOption(option, {notMerge: true, lazyUpdate: true});
  }, [option]);

  return (
    <View style={[styles.wrap, style, {width, height}]}>
      <SkiaChart ref={skiaRef} />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
  },
});

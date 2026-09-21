import React from 'react';
import {Dimensions, StyleSheet, View} from 'react-native';
import {LineChart} from 'react-native-chart-kit';
// ChartConfig is declared in HelperTypes; AbstractChart imports it but does
// not re-export it, so the old path resolved to nothing.
import type {ChartConfig} from 'react-native-chart-kit/dist/HelperTypes';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export interface ChartDataset {
  data: number[];
  color?: (opacity: number) => string;
  strokeWidth?: number;
  label?: string;
}

export interface ChartComponentProps {
  /** X-axis labels (Session Timeline) */
  xAxisLabels?: string[];
  /** Y-axis labels (Level values) */
  yAxisLabels?: string[];
  /** Chart datasets - each dataset represents a line */
  datasets: ChartDataset[];
  /** Chart width - defaults to screen width minus padding */
  width?: number;
  /** Chart height */
  height?: number;
  /** Show legend */
  showLegend?: boolean;
  /** Legend labels */
  legendLabels?: string[];
  /** Chart configuration */
  chartConfig?: ChartConfig;
}

const defaultChartConfig = {
  backgroundColor: '#FFFFFF',
  backgroundGradientFrom: '#FFFFFF',
  backgroundGradientTo: '#FFFFFF',
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`, // #6B7280
  labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`, // #6B7280
  strokeWidth: 2,
  barPercentage: 0.5,
  useShadowColorFromDataset: false,
  propsForDots: {
    r: '2',
    strokeWidth: '1',
    stroke: '#ffa726',
    fill: '#ffffff',
  },
  propsForBackgroundLines: {
    strokeDasharray: '3,3', // Dashed grid lines
    stroke: colors.lightGray2, // #E5E7EB
    strokeWidth: 1,
  },
  propsForLabels: {
    fontSize: ms(12),
    fontFamily: fontFamily.ROBOTO.REGULAR.fontFamily,
    fill: colors.ds.typography.mediumEmphasis, // #6B7280
  },
};

export const ChartComponent: React.FC<ChartComponentProps> = ({
  xAxisLabels = [],
  datasets,
  width,
  height = ms(300),
  chartConfig,
}) => {
  const screenWidth = Dimensions.get('window').width;
  const chartWidth = width || screenWidth - ms(32);

  const chartData = {
    labels: xAxisLabels,
    datasets: datasets.map(dataset => ({
      data: dataset.data,
      color:
        dataset.color || ((opacity: number) => `rgba(0, 0, 0, ${opacity})`),
      strokeWidth: dataset.strokeWidth || 2,
    })),
  };

  return (
    <View style={styles.container}>
      <View style={styles.chartContainer}>
        {/* Single chart with all datasets */}
        <LineChart
          data={chartData}
          width={chartWidth}
          height={height}
          chartConfig={chartConfig || defaultChartConfig}
          bezier
          style={StyleSheet.flatten([styles.chart])}
          withVerticalLabels
          withHorizontalLabels
          withDots
          withShadow={false}
          withInnerLines
          withOuterLines
          yAxisLabel=""
          yAxisSuffix=""
          xAxisLabel=""
        />
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '100%',
  },
  chartContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'box-none',
  },
  chart: {
    marginTop: ms(16),
    borderRadius: ms(16),
    backgroundColor: colors.white,
    marginLeft: -ms(32),
  },
});

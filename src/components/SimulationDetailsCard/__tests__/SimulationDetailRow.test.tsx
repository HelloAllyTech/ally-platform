import React from 'react';
import {render} from '@testing-library/react-native';

import {SimulationDetailRow} from '../SimulationDetailRow';

describe('SimulationDetailRow', () => {
  it('renders label and value', () => {
    const {getByText} = render(
      <SimulationDetailRow label="Duration" value="2 min" />,
    );
    expect(getByText('Duration')).toBeTruthy();
    expect(getByText('2 min')).toBeTruthy();
  });

  it('renders empty value', () => {
    const {getByText} = render(
      <SimulationDetailRow label="Score" value="" />,
    );
    expect(getByText('Score')).toBeTruthy();
    expect(getByText('')).toBeTruthy();
  });

  it('renders long label and value', () => {
    const longLabel = 'Very long label text';
    const longValue = 'Very long value text';
    const {getByText} = render(
      <SimulationDetailRow label={longLabel} value={longValue} />,
    );
    expect(getByText(longLabel)).toBeTruthy();
    expect(getByText(longValue)).toBeTruthy();
  });
});

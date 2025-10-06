import React from 'react';
import {render} from '@testing-library/react-native';

import {SimulationSummarySkeleton} from '../SimulationSummarySkeleton';

describe('SimulationSummarySkeleton', () => {
  it('renders when isLoading', () => {
    const {toJSON} = render(<SimulationSummarySkeleton isLoading />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders null when not loading', () => {
    const {toJSON} = render(<SimulationSummarySkeleton isLoading={false} />);
    expect(toJSON()).toBeNull();
  });
});



import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.Animated.timing = () => ({ start: () => {} } as any);
  RN.Animated.sequence = () => ({ start: () => {} } as any);
  return RN;
});

import {SimulationsSkeleton} from '@/components/LoadingSkeleton/SimulationsSkeleton';

describe('SimulationsSkeleton', () => {
  it('renders skeleton cards', () => {
    const {toJSON} = render(<SimulationsSkeleton count={2} />);
    expect(toJSON()).toBeTruthy();
  });
});

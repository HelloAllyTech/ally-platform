import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.Animated.timing = () => ({ start: () => {} } as any);
  RN.Animated.sequence = () => ({ start: () => {} } as any);
  return RN;
});

import {LoadingSkeleton} from '@/components/LoadingSkeleton';

describe('LoadingSkeleton', () => {
  it('renders the skeleton container and shimmer elements', () => {
    const {toJSON} = render(<LoadingSkeleton />);
    expect(toJSON()).toBeTruthy();
  });
});

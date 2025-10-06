import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.Animated.timing = () => ({ start: () => {} } as any);
  RN.Animated.sequence = () => ({ start: () => {} } as any);
  return RN;
});

import {CallLogSkeleton} from '@/components/LoadingSkeleton/CallLogSkeleton';

describe('CallLogSkeleton', () => {
  it('renders list of skeleton items', () => {
    const {toJSON} = render(<CallLogSkeleton count={2} />);
    expect(toJSON()).toBeTruthy();
  });
});

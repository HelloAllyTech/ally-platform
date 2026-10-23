import React from 'react';
import {render} from '@testing-library/react-native';

import {SkeletonLoader} from '../SkeletonLoader';

jest.useFakeTimers();

describe('SkeletonLoader', () => {
  it('renders shimmer items', () => {
    const {toJSON} = render(<SkeletonLoader />);
    expect(toJSON()).not.toBeNull();
  });
});



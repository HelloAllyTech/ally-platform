import React from 'react';
import {render} from '@testing-library/react-native';

import {Pagination} from '@/components/Carousel/Pagination';

describe('Pagination', () => {
  it('does not render when totalItems <= 1', () => {
    const {queryByTestId} = render(
      <Pagination totalItems={1} currentIndex={0} />,
    );
    expect(queryByTestId('pagination-container')).toBeNull();
  });

  it('renders dots and marks active', () => {
    const {getByTestId} = render(
      <Pagination totalItems={3} currentIndex={1} />,
    );
    expect(getByTestId('pagination-dot-0')).toBeTruthy();
    expect(getByTestId('pagination-dot-1')).toBeTruthy();
    expect(getByTestId('pagination-dot-2')).toBeTruthy();
  });
});

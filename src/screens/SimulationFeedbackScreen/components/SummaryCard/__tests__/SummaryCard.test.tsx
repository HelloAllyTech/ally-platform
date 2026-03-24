import React from 'react';
import {Text} from 'react-native';
import {render} from '@testing-library/react-native';

import {SummaryCard} from '../SummaryCard';

describe('SummaryCard', () => {
  it('renders without crashing', () => {
    expect(() =>
      render(
        <SummaryCard>
          <Text>Child content</Text>
        </SummaryCard>,
      ),
    ).not.toThrow();
  });

  it('renders children', () => {
    const {getByText} = render(
      <SummaryCard>
        <Text>My child content</Text>
      </SummaryCard>,
    );
    expect(getByText('My child content')).toBeTruthy();
  });

  it('renders title when provided', () => {
    const {getByText} = render(
      <SummaryCard title="Test Title">
        <Text>Child</Text>
      </SummaryCard>,
    );
    expect(getByText('Test Title')).toBeTruthy();
    expect(getByText('Child')).toBeTruthy();
  });

  it('does not render title when not provided', () => {
    const {queryByText, getByText} = render(
      <SummaryCard>
        <Text>Child only</Text>
      </SummaryCard>,
    );
    expect(queryByText('Test Title')).toBeNull();
    expect(getByText('Child only')).toBeTruthy();
  });
});

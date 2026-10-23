import React from 'react';
import {render} from '@testing-library/react-native';

import {FlowSection} from '../FlowSection';

describe('CallSummaryScreen/FlowSection', () => {
  it('renders with initial flow text', () => {
    const {getByDisplayValue} = render(<FlowSection flow="abc" />);
    expect(getByDisplayValue('abc')).toBeTruthy();
  });
});



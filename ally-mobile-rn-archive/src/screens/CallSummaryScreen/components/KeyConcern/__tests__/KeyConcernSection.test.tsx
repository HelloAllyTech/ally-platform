import React from 'react';
import {render} from '@testing-library/react-native';

import {KeyConcernSection} from '../KeyConcernSection';

describe('CallSummaryScreen/KeyConcernSection', () => {
  it('renders with initial concerns text', () => {
    const {getByDisplayValue} = render(<KeyConcernSection concerns="xyz" />);
    expect(getByDisplayValue('xyz')).toBeTruthy();
  });
});



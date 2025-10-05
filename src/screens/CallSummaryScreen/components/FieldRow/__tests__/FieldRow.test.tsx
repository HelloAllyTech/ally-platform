import React from 'react';
import {render} from '@testing-library/react-native';

import {FieldRow} from '../FieldRow';

describe('CallSummaryScreen/FieldRow', () => {
  it('renders label and value', () => {
    const {getByText} = render(<FieldRow label="Label" value="Value" />);
    expect(getByText('Label:')).toBeTruthy();
    expect(getByText('Value')).toBeTruthy();
  });
});



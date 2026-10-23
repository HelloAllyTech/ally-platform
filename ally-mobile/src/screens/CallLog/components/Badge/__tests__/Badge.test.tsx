import React from 'react';
import {render} from '@testing-library/react-native';

import {Badge} from '@/screens/CallLog/components/Badge/Badge';

describe('Badge', () => {
  it('renders children text', () => {
    const {getByText} = render(<Badge>New</Badge>);
    expect(getByText('New')).toBeTruthy();
  });
});

import React from 'react';
import {render} from '@testing-library/react-native';

import {Tag} from '@/screens/CallLog/components/Tag/Tag';

describe('Tag', () => {
  it('renders label', () => {
    const {getByText} = render(
      <Tag label="help" color="#eee" textColor="#111" />,
    );
    expect(getByText('help')).toBeTruthy();
  });
});
